import { env } from 'cloudflare:workers'
import { sql } from 'drizzle-orm'
import { expect } from 'vitest'

import { createDb, type Db } from '@/db/client'
import { invoices, payments } from '@/db/schema'
import { sumCents, type Invoice, type InvoiceWithLines, type NewInvoice, type NewLineItem } from '@/domain/invoice'
import { invoicesWithLines } from '@/domain/queries'
import type { Payment } from '@/domain/payment'
import { diff, expand, type AccountId } from '@/framework/ledger'
import { entries } from '@/ledger/entries'

export async function freshDb(): Promise<Db> {
  const db = createDb(env.DB)
  await db.batch([
    // Invoices go before their lines: the last-line guard only protects invoices that still exist.
    db.run(sql`PRAGMA defer_foreign_keys = on`),
    db.run(sql`DELETE FROM ledger_entries`),
    db.run(sql`DELETE FROM invoice_transitions`),
    db.run(sql`DELETE FROM invoices`),
    db.run(sql`DELETE FROM invoice_batches`),
    db.run(sql`DELETE FROM invoice_line_items`),
    db.run(sql`DELETE FROM payments`),
    db.run(sql`DELETE FROM accounts`),
    db.run(sql`DELETE FROM parties`),
    db.run(sql`INSERT INTO parties (id, name, kind, venmo_handle) VALUES
      ('me', 'Me', 'me', NULL),
      ('sam', 'Sam', 'roommate', 'sam-v'),
      ('alex', 'Alex', 'roommate', 'alex-v'),
      ('coned', 'ConEd', 'provider', NULL)`)
  ])
  return db
}

export type InvoiceOverrides = Partial<Omit<NewInvoice, 'lineItems'>> & {
  /** Shorthand for a single line of this amount (default 10000). */
  amountCents?: number
  /** Category of the single shorthand line (default utilities). */
  category?: string
  lineItems?: NewLineItem[]
}

export function newInvoice(id: string, overrides: InvoiceOverrides = {}): NewInvoice {
  const { amountCents = 10000, category = 'utilities', lineItems, ...rest } = overrides
  return {
    id,
    payerId: 'sam',
    payeeId: 'me',
    description: id,
    issuedAt: '2026-01-01T00:00:00Z',
    dueDate: '2026-02-01',
    lineItems: lineItems ?? [{ description: id, category, amountCents }],
    ...rest
  }
}

export function newPayment(id: string, overrides: Partial<Payment> = {}): Payment {
  return {
    id,
    payerId: 'sam',
    payeeId: 'me',
    amountCents: 5000,
    paidAt: '2026-01-15T00:00:00Z',
    method: 'venmo',
    reference: null,
    ...overrides
  }
}

export async function allInvoices(db: Db): Promise<InvoiceWithLines[]> {
  const rows = await db.select({ id: invoices.id }).from(invoices)
  return invoicesWithLines(
    db,
    rows.map(r => r.id)
  )
}

/** Independent FIFO: payments of a (payer, payee) pair applied to its non-void invoices by (issuedAt, id). */
export function expectedSettlement(invs: readonly Invoice[], pays: readonly Payment[]): Map<string, number> {
  const out = new Map<string, number>()
  const pairs = new Set(invs.map(i => `${i.payerId}>${i.payeeId}`))
  for (const pair of pairs) {
    let pool = pays.filter(p => `${p.payerId}>${p.payeeId}` === pair).reduce((s, p) => s + p.amountCents, 0)
    const ordered = invs
      .filter(i => `${i.payerId}>${i.payeeId}` === pair && i.status !== 'void')
      .sort((a, b) => (a.issuedAt === b.issuedAt ? a.id.localeCompare(b.id) : a.issuedAt.localeCompare(b.issuedAt)))
    for (const inv of ordered) {
      const applied = Math.min(inv.amountCents, pool)
      pool -= applied
      out.set(inv.id, applied)
    }
  }
  return out
}

/** Balanced groups, rebuild-from-documents, and independent FIFO all agree with the stored state. */
export async function assertConsistent(db: Db): Promise<void> {
  const unbalanced = await db.all(
    sql`SELECT entry_group_id FROM ledger_entries GROUP BY entry_group_id HAVING sum(amount_cents) != 0`
  )
  expect(unbalanced).toEqual([])

  const invs = await allInvoices(db)
  const pays = await db.select().from(payments)

  // The denormalised amount equals the sum of the lines for every invoice.
  for (const inv of invs) {
    expect({ id: inv.id, lines: inv.lineItems.length > 0, amount: inv.amountCents }).toEqual({
      id: inv.id,
      lines: true,
      amount: sumCents(inv.lineItems)
    })
  }

  const replayed: Record<string, number> = {}
  const add = (lines: ReturnType<typeof expand>): void => {
    for (const [acc, cents] of Object.entries(diff(lines))) replayed[acc] = (replayed[acc] ?? 0) + cents
  }
  // A void invoice's issue + reversal net to zero, so only live invoices are replayed.
  for (const inv of invs.filter(i => i.status !== 'void')) {
    add(expand('invoiceIssued', entries.invoiceIssued, inv, inv.issuedAt))
  }
  for (const p of pays) add(expand('payment', entries.payment, p, p.paidAt))
  const stored = await db.all<{ accountId: AccountId; total: number }>(
    sql`SELECT account_id AS accountId, sum(amount_cents) AS total FROM ledger_entries GROUP BY account_id HAVING total != 0`
  )
  const storedMap = Object.fromEntries(stored.map(r => [r.accountId, r.total]))
  const replayedNonZero = Object.fromEntries(Object.entries(replayed).filter(([, v]) => v !== 0))
  expect(storedMap).toEqual(replayedNonZero)

  const expected = expectedSettlement(invs, pays)
  for (const inv of invs.filter(i => i.status !== 'void')) {
    const applied = expected.get(inv.id) ?? 0
    expect({ id: inv.id, applied: inv.appliedCents }).toEqual({ id: inv.id, applied })
    const settlement = applied === inv.amountCents ? 'paid' : applied > 0 ? 'partially_paid' : 'unpaid'
    expect({ id: inv.id, settlement: inv.settlement }).toEqual({ id: inv.id, settlement })
  }
}
