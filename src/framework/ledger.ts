import { sql, type SQL } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { SQLiteSyncDialect, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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

/** Cloudflare D1 rejects a statement with more than 100 bound parameters ("too many SQL variables"). */
export const MAX_BOUND_PARAMETERS = 100

const dialect = new SQLiteSyncDialect()
const boundParameters = (query: SQL): number => dialect.sqlToQuery(query).params.length

/** Splits items into consecutive chunks whose parameters, plus `fixed` per statement, fit one D1 statement. */
export function chunkByParameters<T>(items: readonly T[], paramsOf: (item: T) => number, fixed = 0): T[][] {
  const budget = MAX_BOUND_PARAMETERS - fixed
  const chunks: T[][] = []
  let current: T[] = []
  let used = 0
  for (const item of items) {
    const n = paramsOf(item)
    if (n > budget)
      throw new RangeError(`One row needs ${String(n)} bound parameters; a statement allows ${String(budget)}`)
    if (current.length > 0 && used + n > budget) {
      chunks.push(current)
      current = []
      used = 0
    }
    current.push(item)
    used += n
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/** Statements for a `db.batch`, which takes a non-empty tuple. */
export type Statements = readonly [Statement, ...Statement[]]

function nonEmpty(statements: readonly Statement[]): Statements {
  const [first, ...rest] = statements
  if (first === undefined) throw new Error('Nothing to post: the entry has no lines')
  return [first, ...rest]
}

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
  /**
   * Statements to include, in order, in one `db.batch` (several when the lines exceed D1's bound-parameter limit).
   * Write the source document first. Idempotent: inserts nothing if the source was already posted.
   */
  post: <K extends keyof Defs & string>(kind: K, source: SourceOf<Defs[K]>, at?: string) => Statements
  /** Statements for one `db.batch`, like `post`. Idempotent: inserts nothing if the original was never posted or is already reversed. */
  reverse: <K extends keyof Defs & string>(kind: K, source: SourceOf<Defs[K]>, at?: string) => Statements
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

  /** `INSERT ... SELECT * FROM (VALUES ...) WHERE guard`, in as many statements as D1's parameter limit needs. */
  const insertEntries = (rows: readonly SQL[], guard: SQL): Statements =>
    nonEmpty(
      chunkByParameters(rows, boundParameters, boundParameters(guard)).map(chunk =>
        db.insert(t.entries).select(sql`SELECT * FROM (VALUES ${sql.join(chunk, sql`, `)}) WHERE ${guard}`)
      )
    )

  return {
    post(kind, source, at) {
      const { def, fk } = resolve(kind)
      const doc = source as { id: string }
      const lines = expand(kind, def, doc, at ?? def.occurredAt(doc))
      const groupId = crypto.randomUUID()
      const accounts = [...new Set(lines.map(l => l.accountId))].map(id => ({ id, kind: options.accountKind(id) }))
      // A later chunk of this group must not be blocked by the earlier chunks, only by another posting.
      const notYetPosted = sql`NOT EXISTS (SELECT 1 FROM ledger_entries
            WHERE ${sql.raw(fk)} = ${doc.id} AND kind = ${kind} AND reverses_group_id IS NULL
              AND entry_group_id <> ${groupId})`
      return nonEmpty([
        ...chunkByParameters(accounts, () => 2).map(chunk => db.insert(t.accounts).values(chunk).onConflictDoNothing()),
        ...insertEntries(
          lines.map(l => row(l, groupId, fk, null)),
          notYetPosted
        )
      ])
    },

    reverse(kind, source, at) {
      const { def, fk } = resolve(kind)
      const doc = source as { id: string }
      const original = sql`(SELECT entry_group_id FROM ledger_entries
        WHERE ${sql.raw(fk)} = ${doc.id} AND kind = ${kind} AND reverses_group_id IS NULL LIMIT 1)`
      const lines = expand(kind, def, doc, at ?? new Date().toISOString(), -1)
      const groupId = crypto.randomUUID()
      return insertEntries(
        lines.map(l => row(l, groupId, fk, original)),
        sql`${original} IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ledger_entries
            WHERE reverses_group_id = ${original} AND entry_group_id <> ${groupId})`
      )
    }
  }
}
