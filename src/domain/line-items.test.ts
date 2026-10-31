import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'

import type { Db } from '@/db/client'
import { invoiceLineItems } from '@/db/schema'
import { assertConsistent, freshDb, newInvoice } from '@/testing/helpers'

import { issueInvoice, voidInvoice } from './services'
import { splitBills } from './split'

let db: Db
beforeEach(async () => {
  db = await freshDb()
})

/** Drizzle wraps driver errors; the trigger's message is on the cause. */
const rejectsWith = async (op: PromiseLike<unknown>, message: RegExp): Promise<void> => {
  const err: unknown = await Promise.resolve(op).then(
    () => undefined,
    (e: unknown) => e
  )
  if (!(err instanceof Error)) throw new Error('expected the statement to be rejected')
  expect(err.cause instanceof Error ? err.cause.message : err.message).toMatch(message)
}

const amountOf = async (id: string): Promise<number | undefined> =>
  (await db.all<{ amount: number }>(sql`SELECT amount_cents AS amount FROM invoices WHERE id = ${id}`))[0]?.amount

const twoLines = [
  { description: 'Electric', category: 'utilities', amountCents: 7000 },
  { description: 'Groceries', category: 'groceries', amountCents: 2500 }
]

describe('line items', () => {
  it('invoice amount is the sum of its lines', async () => {
    const inv = await issueInvoice(db, newInvoice('a', { lineItems: twoLines }))
    expect(inv.amountCents).toBe(9500)
    expect(inv.lineItems.map(l => l.position)).toEqual([0, 1])
    await assertConsistent(db)
  })

  it('the trigger recomputes the amount on insert, update and delete of lines of an unposted invoice', async () => {
    await db.run(sql`INSERT INTO invoices (id, payer_id, payee_id, amount_cents, description, issued_at, due_date)
      VALUES ('d', 'sam', 'me', 100, 'draft', '2026-01-01T00:00:00Z', '2026-02-01')`)
    const add = (id: string, cents: number, position: number): Promise<unknown> =>
      db.insert(invoiceLineItems).values({
        id,
        invoiceId: 'd',
        position,
        description: id,
        category: 'utilities',
        amountCents: cents
      })
    await add('l1', 100, 0)
    await add('l2', 250, 1)
    expect(await amountOf('d')).toBe(350)
    await db.run(sql`UPDATE invoice_line_items SET amount_cents = 400 WHERE id = 'l2'`)
    expect(await amountOf('d')).toBe(500)
    await db.run(sql`DELETE FROM invoice_line_items WHERE id = 'l1'`)
    expect(await amountOf('d')).toBe(400)
  })

  it('the last line of an invoice cannot be deleted or moved away', async () => {
    await db.run(sql`INSERT INTO invoices (id, payer_id, payee_id, amount_cents, description, issued_at, due_date)
      VALUES ('d', 'sam', 'me', 100, 'draft', '2026-01-01T00:00:00Z', '2026-02-01'),
             ('e', 'sam', 'me', 100, 'other', '2026-01-01T00:00:00Z', '2026-02-01')`)
    await db.run(sql`INSERT INTO invoice_line_items VALUES ('l1', 'd', 0, 'x', 'utilities', 100),
                                                          ('l2', 'e', 0, 'y', 'utilities', 100)`)
    await rejectsWith(db.run(sql`DELETE FROM invoice_line_items WHERE id = 'l1'`), /at least one line/)
    await rejectsWith(db.run(sql`UPDATE invoice_line_items SET invoice_id = 'e' WHERE id = 'l1'`), /at least one line/)
    expect(await amountOf('d')).toBe(100)
  })

  it('lines of a posted invoice are frozen, including after a void', async () => {
    await issueInvoice(db, newInvoice('a', { lineItems: twoLines }))
    const frozen = /invoice is posted; void and reissue/
    await rejectsWith(db.run(sql`UPDATE invoice_line_items SET amount_cents = 1 WHERE invoice_id = 'a'`), frozen)
    await rejectsWith(db.run(sql`DELETE FROM invoice_line_items WHERE invoice_id = 'a'`), frozen)
    await rejectsWith(
      db.insert(invoiceLineItems).values({
        id: 'extra',
        invoiceId: 'a',
        position: 2,
        description: 'late',
        category: 'utilities',
        amountCents: 100
      }),
      frozen
    )
    await voidInvoice(db, 'a', '2026-02-01T00:00:00Z')
    await rejectsWith(db.run(sql`DELETE FROM invoice_line_items WHERE invoice_id = 'a'`), frozen)
    expect(await amountOf('a')).toBe(9500)
    await assertConsistent(db)
  })

  it('posts one expense account per line category and voiding nets every account to zero', async () => {
    await issueInvoice(db, newInvoice('a', { lineItems: twoLines }))
    const total = async (account: string): Promise<number | undefined> =>
      (
        await db.all<{ n: number }>(
          sql`SELECT coalesce(sum(amount_cents), 0) AS n FROM ledger_entries WHERE account_id = ${account}`
        )
      )[0]?.n
    expect(await total('expense:utilities')).toBe(-7000)
    expect(await total('expense:groceries')).toBe(-2500)
    expect(await total('receivable:sam')).toBe(9500)
    await voidInvoice(db, 'a', '2026-02-01T00:00:00Z')
    expect([await total('expense:utilities'), await total('expense:groceries'), await total('receivable:sam')]).toEqual(
      [0, 0, 0]
    )
    await assertConsistent(db)
  })

  it('FIFO counts a multi-line invoice once', async () => {
    await issueInvoice(db, newInvoice('a', { lineItems: twoLines, issuedAt: '2026-01-01T00:00:00Z' }))
    const b = await issueInvoice(db, newInvoice('b', { amountCents: 5000, issuedAt: '2026-01-02T00:00:00Z' }))
    expect([b.settlement, b.appliedCents]).toEqual(['unpaid', 0])
    await assertConsistent(db)
  })
})

describe('splitBills', () => {
  const bill = (description: string, lines: [string, number][]): Parameters<typeof splitBills>[0][number] => ({
    description,
    lineItems: lines.map(([category, amountCents]) => ({ description: category, category, amountCents }))
  })

  it('splits a single-line bill with largest remainder, roommates first', () => {
    const { roommateLines, myShareCents } = splitBills([bill('ConEd Jul', [['utilities', 10000]])], 2)
    expect(roommateLines.map(l => l.map(x => x.amountCents))).toEqual([[3334], [3333]])
    expect(roommateLines[0]?.[0]?.description).toBe('ConEd Jul share')
    expect(myShareCents).toBe(3333)
  })

  it('keeps every line exact and a bill within one cent per party across lines', () => {
    const { roommateLines, myShareCents } = splitBills(
      [
        bill('B', [
          ['a', 1001],
          ['b', 1001],
          ['c', 1001]
        ])
      ],
      2
    )
    const totals = roommateLines.map(l => l.reduce((s, x) => s + x.amountCents, 0))
    expect(totals.reduce((a, b) => a + b, myShareCents)).toBe(3003)
    expect(Math.max(...totals, myShareCents) - Math.min(...totals, myShareCents)).toBeLessThanOrEqual(1)
  })
})
