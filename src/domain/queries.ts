import { and, asc, desc, eq, getTableColumns, inArray, ne, or, sql, type SQL } from 'drizzle-orm'

import type { Db } from '@/db/client'
import { invoiceLineItems, invoices, invoiceTransitions, parties, payments } from '@/db/schema'
import type { AccountId } from '@/framework/ledger'
import { ME } from '@/ledger/accounts'

import type { Invoice, InvoiceStatus, InvoiceWithLines, LineItem, Settlement } from './invoice'
import type { Party } from './party'
import type { Payment } from './payment'

/** One index-only read. Optionally as of a timestamp (inclusive). */
export async function balance(db: Db, accountId: AccountId, asOf?: string): Promise<number> {
  const rows = await db.all<{ total: number }>(sql`
    SELECT coalesce(sum(amount_cents), 0) AS total FROM ledger_entries
    WHERE account_id = ${accountId} ${asOf === undefined ? sql`` : sql`AND occurred_at <= ${asOf}`}`)
  return rows[0]?.total ?? 0
}

/** Source-document columns joined onto ledger lines (null when the line has no such source). */
export interface LineSource {
  invoiceId: string | null
  paymentId: string | null
  invoiceDescription: string | null
  invoiceStatus: InvoiceStatus | null
  paymentMethod: Payment['method'] | null
  paymentReference: string | null
}

export interface StatementLine extends LineSource {
  entryId: string
  entryGroupId: string
  occurredAt: string
  kind: string
  reversesGroupId: string | null
  /** Ledger sign: debit +, credit -. */
  amountCents: number
  balanceCents: number
}

/** Ledger lines of an account with a running balance. The window runs over the whole account, then `from`/`to` filter. */
export async function statement(
  db: Db,
  accountId: AccountId,
  range: { from?: string; to?: string } = {}
): Promise<StatementLine[]> {
  // An invoice posts one transfer per line item; the statement shows one row per entry group and account.
  const rows = await db.all<StatementLine & { seq: number }>(sql`
    SELECT * FROM (
      SELECT min(e.id) AS entryId, e.entry_group_id AS entryGroupId, e.occurred_at AS occurredAt, e.kind,
             e.reverses_group_id AS reversesGroupId, e.invoice_id AS invoiceId, e.payment_id AS paymentId,
             sum(e.amount_cents) AS amountCents, min(e.rowid) AS seq,
             sum(sum(e.amount_cents)) OVER (ORDER BY e.occurred_at, min(e.rowid)) AS balanceCents,
             i.description AS invoiceDescription, i.status AS invoiceStatus,
             p.method AS paymentMethod, p.reference AS paymentReference
        FROM ledger_entries e
        LEFT JOIN invoices i ON i.id = e.invoice_id
        LEFT JOIN payments p ON p.id = e.payment_id
       WHERE e.account_id = ${accountId}
       GROUP BY e.entry_group_id
    )
    WHERE 1 = 1
      ${range.from === undefined ? sql`` : sql`AND occurredAt >= ${range.from}`}
      ${range.to === undefined ? sql`` : sql`AND occurredAt <= ${range.to}`}
    ORDER BY occurredAt, seq`)
  return rows.map(({ seq: _seq, ...line }) => line)
}

export interface PostingLine extends LineSource {
  entryId: string
  accountId: string
  occurredAt: string
  kind: string
  reversesGroupId: string | null
  amountCents: number
}

/** All lines of one entry group, in insertion order. Empty when the group does not exist. */
export async function posting(db: Db, entryGroupId: string): Promise<PostingLine[]> {
  return db.all<PostingLine>(sql`
    SELECT e.id AS entryId, e.account_id AS accountId, e.occurred_at AS occurredAt, e.kind,
           e.reverses_group_id AS reversesGroupId, e.amount_cents AS amountCents,
           e.invoice_id AS invoiceId, e.payment_id AS paymentId,
           i.description AS invoiceDescription, i.status AS invoiceStatus,
           p.method AS paymentMethod, p.reference AS paymentReference
      FROM ledger_entries e
      LEFT JOIN invoices i ON i.id = e.invoice_id
      LEFT JOIN payments p ON p.id = e.payment_id
     WHERE e.entry_group_id = ${entryGroupId}
     ORDER BY e.rowid`)
}

export async function listParties(db: Db): Promise<Party[]> {
  return db.select().from(parties).orderBy(asc(parties.kind), asc(parties.name))
}

export async function getParty(db: Db, id: string): Promise<Party | undefined> {
  const [row] = await db.select().from(parties).where(eq(parties.id, id))
  return row
}

export async function getParties(db: Db, ids: readonly string[]): Promise<Party[]> {
  return ids.length === 0
    ? []
    : db
        .select()
        .from(parties)
        .where(inArray(parties.id, [...ids]))
}

export interface InvoiceFilter {
  /** incoming = bills I owe (payer is me); outgoing = invoices I issue (payee is me). */
  direction?: 'incoming' | 'outgoing'
  status?: InvoiceStatus
  settlement?: Settlement
}

export type InvoiceListItem = Invoice & { lineCount: number }

export async function listInvoices(db: Db, filter: InvoiceFilter = {}): Promise<InvoiceListItem[]> {
  const conditions: (SQL | undefined)[] = [
    filter.direction === 'incoming' ? eq(invoices.payerId, ME) : undefined,
    filter.direction === 'outgoing' ? eq(invoices.payeeId, ME) : undefined,
    filter.status ? eq(invoices.status, filter.status) : undefined,
    // The settlement cache is not maintained for void invoices, so never match them by it.
    filter.settlement ? and(eq(invoices.settlement, filter.settlement), ne(invoices.status, 'void')) : undefined
  ]
  return db
    .select({
      ...getTableColumns(invoices),
      // Qualified by hand: Drizzle renders a single-table select's columns unqualified, which the subquery would capture.
      lineCount: sql<number>`(SELECT count(*) FROM invoice_line_items li WHERE li.invoice_id = invoices.id)`
    })
    .from(invoices)
    .where(and(...conditions))
    .orderBy(desc(invoices.issuedAt), desc(invoices.id))
}

export async function invoicesByIds(db: Db, ids: readonly string[]): Promise<Invoice[]> {
  return ids.length === 0
    ? []
    : db
        .select()
        .from(invoices)
        .where(inArray(invoices.id, [...ids]))
}

export async function lineItemsOf(db: Db, invoiceIds: readonly string[]): Promise<LineItem[]> {
  return invoiceIds.length === 0
    ? []
    : db
        .select()
        .from(invoiceLineItems)
        .where(inArray(invoiceLineItems.invoiceId, [...invoiceIds]))
        .orderBy(asc(invoiceLineItems.invoiceId), asc(invoiceLineItems.position))
}

/** Invoices with their lines (ordered by position), in the order of `ids`; unknown ids are skipped. */
export async function invoicesWithLines(db: Db, ids: readonly string[]): Promise<InvoiceWithLines[]> {
  const [rows, lines] = await Promise.all([invoicesByIds(db, ids), lineItemsOf(db, ids)])
  return ids.flatMap(id => {
    const inv = rows.find(r => r.id === id)
    return inv ? [{ ...inv, lineItems: lines.filter(l => l.invoiceId === id) }] : []
  })
}

export async function transitionsOf(db: Db, invoiceId: string) {
  return db
    .select({
      fromStatus: invoiceTransitions.fromStatus,
      toStatus: invoiceTransitions.toStatus,
      at: invoiceTransitions.at,
      note: invoiceTransitions.note
    })
    .from(invoiceTransitions)
    .where(eq(invoiceTransitions.invoiceId, invoiceId))
    .orderBy(asc(invoiceTransitions.id))
}

export async function listPayments(db: Db, partyId?: string): Promise<Payment[]> {
  return db
    .select()
    .from(payments)
    .where(partyId === undefined ? undefined : or(eq(payments.payerId, partyId), eq(payments.payeeId, partyId)))
    .orderBy(desc(payments.paidAt), desc(payments.id))
}

/** Net ledger balance per party account: receivables (what roommates owe me) and payables (what I owe providers, as a positive number). */
export async function partyBalances(
  db: Db
): Promise<{ receivables: Map<string, number>; payables: Map<string, number> }> {
  const rows = await db.all<{ accountId: string; total: number }>(sql`
    SELECT account_id AS accountId, sum(amount_cents) AS total FROM ledger_entries
     WHERE party_leg GROUP BY account_id`)
  const receivables = new Map<string, number>()
  const payables = new Map<string, number>()
  for (const { accountId, total } of rows) {
    if (accountId.startsWith('receivable:')) receivables.set(accountId.slice('receivable:'.length), total)
    else if (accountId.startsWith('payable:')) payables.set(accountId.slice('payable:'.length), -total)
  }
  return { receivables, payables }
}
