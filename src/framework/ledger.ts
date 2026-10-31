import { sql, type SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Generic double-entry ledger framework. Never imports app code.
 *
 * Storage contract (tables owned by the app's schema): `accounts(id, kind)` and
 * `ledger_entries(id, entry_group_id, account_id, amount_cents, occurred_at, kind,
 * reverses_group_id, party_leg, <one nullable FK column per source>)`.
 */

export type AccountId = string & { readonly __brand: 'AccountId' }

export interface Transfer {
  debit: AccountId
  credit: AccountId
  amountCents: number
}

export interface EntryDef<S extends { id: string }, Src extends string = string> {
  /** Which source (and therefore which FK column) the lines link to. */
  source: Src
  transfers: (source: S) => readonly Transfer[]
  /** Default `occurred_at` when posting. */
  occurredAt: (source: S) => string
}

export function defineEntry<S extends { id: string }, const Src extends string>(
  def: EntryDef<S, Src>
): EntryDef<S, Src> {
  return def
}

/** A line before ids and the party-leg flag are assigned. */
export interface LedgerLine<Src extends string = string> {
  kind: string
  source: Src
  sourceId: string
  accountId: AccountId
  amountCents: number
  occurredAt: string
  reversesGroupId: string | null
}

export type SourceOf<D> = D extends EntryDef<infer S> ? S : never

function assertPositiveInt(n: number): void {
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new RangeError(`Transfer amount must be a positive integer of cents, got ${n}`)
}

/** Pure: a transfer debits one account and credits another, so the lines always sum to zero. `sign = -1` flips (reversal). */
export function expand<S extends { id: string }, Src extends string>(
  kind: string,
  def: EntryDef<S, Src>,
  source: S,
  occurredAt: string,
  sign: 1 | -1 = 1,
  reversesGroupId: string | null = null
): LedgerLine<Src>[] {
  return def.transfers(source).flatMap(t => {
    assertPositiveInt(t.amountCents)
    const base = { kind, source: def.source, sourceId: source.id, occurredAt, reversesGroupId }
    return [
      { ...base, accountId: t.debit, amountCents: sign * t.amountCents },
      { ...base, accountId: t.credit, amountCents: -sign * t.amountCents }
    ]
  })
}

/** Pure: net amount per account. */
export function diff(lines: readonly LedgerLine[]): Record<AccountId, number> {
  const out: Record<AccountId, number> = {}
  for (const l of lines) out[l.accountId] = (out[l.accountId] ?? 0) + l.amountCents
  return out
}

export interface LedgerOptions<Src extends string> {
  /** Value for `accounts.kind` of a given account id (used for INSERT OR IGNORE). */
  accountKind: (id: AccountId) => string
  /** True for accounts that represent the counterparty (sets `party_leg`). */
  isPartyAccount: (id: AccountId) => boolean
  /** Source name -> FK column on `ledger_entries`, e.g. `{ invoice: 'invoice_id', payment: 'payment_id' }`. */
  sourceColumns: Readonly<Record<Src, string>>
}

type LedgerDb = Pick<DrizzleD1Database, 'insert'>
type Statement = BatchItem<'sqlite'>

const BASE_COLUMNS = [
  'id',
  'entry_group_id',
  'account_id',
  'amount_cents',
  'occurred_at',
  'kind',
  'reverses_group_id',
  'party_leg'
] as const

/** Drizzle table handles used only to build batch-able statements; they mirror the app's tables. */
function tables(fkColumns: readonly string[]) {
  const text_ = (name: string) => [name, text(name)] as const
  return {
    accounts: sqliteTable('accounts', { id: text('id'), kind: text('kind') }),
    entries: sqliteTable('ledger_entries', Object.fromEntries([...BASE_COLUMNS, ...fkColumns].map(text_)))
  }
}

export interface Ledger<Defs extends Record<string, EntryDef<never>>> {
  /** Statements to include, in order, in a `db.batch`. Write the source document first. Idempotent: inserts nothing if the source was already posted. */
  post: <K extends keyof Defs & string>(
    kind: K,
    source: SourceOf<Defs[K]>,
    at?: string
  ) => readonly [Statement, Statement]
  /** Idempotent: inserts nothing if the original was never posted or is already reversed. */
  reverse: <K extends keyof Defs & string>(kind: K, source: SourceOf<Defs[K]>, at?: string) => Statement
}

export function makeLedger<Defs extends Record<string, EntryDef<never>>, Src extends string>(
  db: LedgerDb,
  defs: Defs,
  options: LedgerOptions<Src>
): Ledger<Defs> {
  const fkColumns = [...new Set(Object.values<string>(options.sourceColumns))]
  const t = tables(fkColumns)

  function resolve(kind: string): { def: EntryDef<{ id: string }>; fk: string } {
    const def = defs[kind] as EntryDef<{ id: string }> | undefined
    if (!def) throw new Error(`Unknown entry kind: ${kind}`)
    const column = options.sourceColumns[def.source as Src] as string | undefined
    if (column === undefined) throw new Error(`No FK column for source: ${def.source}`)
    return { def, fk: column }
  }

  /** One VALUES row; `reversesGroupId` may itself be a SQL expression. */
  const row = (l: LedgerLine, groupId: string, fk: string, reverses: SQL | string | null): SQL => {
    const fks = fkColumns.map(c => (c === fk ? sql`${l.sourceId}` : sql`NULL`))
    return sql`(${sql.join(
      [
        sql`${crypto.randomUUID()}`,
        sql`${groupId}`,
        sql`${l.accountId}`,
        sql`${l.amountCents}`,
        sql`${l.occurredAt}`,
        sql`${l.kind}`,
        sql`${reverses}`,
        sql`${options.isPartyAccount(l.accountId) ? 1 : 0}`,
        ...fks
      ],
      sql`, `
    )})`
  }

  return {
    post(kind, source, at) {
      const { def, fk } = resolve(kind)
      const doc = source as { id: string }
      const lines = expand(kind, def, doc, at ?? def.occurredAt(doc))
      const groupId = crypto.randomUUID()
      const accountIds = [...new Set(lines.map(l => l.accountId))]
      return [
        db
          .insert(t.accounts)
          .values(accountIds.map(id => ({ id, kind: options.accountKind(id) })))
          .onConflictDoNothing(),
        db.insert(t.entries).select(
          sql`SELECT * FROM (VALUES ${sql.join(
            lines.map(l => row(l, groupId, fk, null)),
            sql`, `
          )})
          WHERE NOT EXISTS (SELECT 1 FROM ledger_entries
            WHERE ${sql.raw(fk)} = ${doc.id} AND kind = ${kind} AND reverses_group_id IS NULL)`
        )
      ] as const
    },

    reverse(kind, source, at) {
      const { def, fk } = resolve(kind)
      const doc = source as { id: string }
      const original = sql`(SELECT entry_group_id FROM ledger_entries
        WHERE ${sql.raw(fk)} = ${doc.id} AND kind = ${kind} AND reverses_group_id IS NULL LIMIT 1)`
      const lines = expand(kind, def, doc, at ?? new Date().toISOString(), -1)
      const groupId = crypto.randomUUID()
      return db.insert(t.entries).select(sql`SELECT * FROM (VALUES ${sql.join(
        lines.map(l => row(l, groupId, fk, original)),
        sql`, `
      )})
        WHERE ${original} IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE reverses_group_id = ${original})`)
    }
  }
}
