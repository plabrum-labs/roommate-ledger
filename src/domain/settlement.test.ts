import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'

import type { Db } from '@/db/client'
import { invoiceLineItems, invoices } from '@/db/schema'
import { ledger } from '@/ledger'
import { acct } from '@/ledger/accounts'
import { assertConsistent, freshDb, newInvoice, newPayment } from '@/testing/helpers'

import type { InvoiceWithLines } from './invoice'
import { Conflict } from './errors'
import { balance, statement } from './queries'
import { getInvoice, getInvoiceWithLines, issueInvoice, recordPayment, requestInvoice, voidInvoice } from './services'

const state = async (db: Db, id: string): Promise<[string, number]> => {
  const i = await getInvoice(db, id)
  return [i.settlement, i.appliedCents]
}
const at = (day: number): string => `2026-02-${String(day).padStart(2, '0')}T00:00:00Z`

const insertWithoutPosting = async (): Promise<InvoiceWithLines> => {
  const { lineItems, ...rest } = newInvoice('x')
  await db
    .insert(invoices)
    .values({ ...rest, amountCents: 10000, status: 'issued', settlement: 'unpaid', appliedCents: 0 })
  await db
    .insert(invoiceLineItems)
    .values(lineItems.map((l, position) => ({ ...l, id: `x-${position}`, invoiceId: 'x', position })))
  return getInvoiceWithLines(db, 'x')
}

let db: Db
beforeEach(async () => {
  db = await freshDb()
})

describe('roommate receivable FIFO', () => {
  it('balance is 0 before invoicing, rises after, falls with payments', async () => {
    expect(await balance(db, acct.receivable('sam'))).toBe(0)
    await issueInvoice(db, newInvoice('a', { amountCents: 10000 }))
    expect(await balance(db, acct.receivable('sam'))).toBe(10000)
    await recordPayment(db, newPayment('p1', { amountCents: 4000 }))
    expect(await balance(db, acct.receivable('sam'))).toBe(6000)
    await recordPayment(db, newPayment('p2', { amountCents: 6000 }))
    expect(await balance(db, acct.receivable('sam'))).toBe(0)
    await assertConsistent(db)
  })

  it('exact payment', async () => {
    await issueInvoice(db, newInvoice('a'))
    await recordPayment(db, newPayment('p1', { amountCents: 10000 }))
    expect(await state(db, 'a')).toEqual(['paid', 10000])
    await assertConsistent(db)
  })

  it('partial payment', async () => {
    await issueInvoice(db, newInvoice('a'))
    await recordPayment(db, newPayment('p1', { amountCents: 2500 }))
    expect(await state(db, 'a')).toEqual(['partially_paid', 2500])
    await assertConsistent(db)
  })

  it('overpayment is credit and a later invoice absorbs it', async () => {
    await issueInvoice(db, newInvoice('a', { amountCents: 10000 }))
    await recordPayment(db, newPayment('p1', { amountCents: 15000 }))
    expect(await state(db, 'a')).toEqual(['paid', 10000])
    expect(await balance(db, acct.receivable('sam'))).toBe(-5000)
    await issueInvoice(db, newInvoice('b', { amountCents: 8000, issuedAt: at(1) }))
    expect(await state(db, 'b')).toEqual(['partially_paid', 5000])
    expect(await balance(db, acct.receivable('sam'))).toBe(3000)
    await assertConsistent(db)
  })

  it('lump payment spans two invoices in FIFO order', async () => {
    await issueInvoice(db, newInvoice('a', { amountCents: 6000, issuedAt: at(1) }))
    await issueInvoice(db, newInvoice('b', { amountCents: 6000, issuedAt: at(2) }))
    await recordPayment(db, newPayment('p1', { amountCents: 9000 }))
    expect(await state(db, 'a')).toEqual(['paid', 6000])
    expect(await state(db, 'b')).toEqual(['partially_paid', 3000])
    await assertConsistent(db)
  })

  it('voiding a middle invoice reallocates to later ones', async () => {
    await issueInvoice(db, newInvoice('a', { amountCents: 5000, issuedAt: at(1) }))
    await issueInvoice(db, newInvoice('b', { amountCents: 5000, issuedAt: at(2) }))
    await issueInvoice(db, newInvoice('c', { amountCents: 5000, issuedAt: at(3) }))
    await recordPayment(db, newPayment('p1', { amountCents: 7500 }))
    expect(await state(db, 'b')).toEqual(['partially_paid', 2500])
    expect(await state(db, 'c')).toEqual(['unpaid', 0])
    await voidInvoice(db, 'b', at(10))
    expect(await state(db, 'a')).toEqual(['paid', 5000])
    expect(await state(db, 'c')).toEqual(['partially_paid', 2500])
    expect(await balance(db, acct.receivable('sam'))).toBe(10000 - 7500)
    await assertConsistent(db)
  })

  it('void is idempotent at the ledger level and a 409 at the service level', async () => {
    const inv = await issueInvoice(db, newInvoice('a'))
    await voidInvoice(db, 'a', at(5))
    await expect(voidInvoice(db, 'a', at(6))).rejects.toBeInstanceOf(Conflict)
    const count = async (): Promise<number> =>
      (await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM ledger_entries`))[0]?.n ?? -1
    expect(await count()).toBe(4)

    // Directly re-running the reversal inserts nothing.
    await db.batch([ledger(db).reverse('invoiceIssued', inv, at(7))])
    expect(await count()).toBe(4)
    expect(await balance(db, acct.receivable('sam'))).toBe(0)
    const trans = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM invoice_transitions`)
    expect(trans[0]?.n).toBe(1)
    await assertConsistent(db)
  })

  it('reverse of a never-posted invoice inserts nothing', async () => {
    const inv = await insertWithoutPosting()
    await db.batch([ledger(db).reverse('invoiceIssued', inv)])
    expect(await balance(db, acct.receivable('sam'))).toBe(0)
  })

  it('payments are idempotent on id', async () => {
    await issueInvoice(db, newInvoice('a'))
    await recordPayment(db, newPayment('p1'))
    await recordPayment(db, newPayment('p1'))
    expect(await balance(db, acct.receivable('sam'))).toBe(5000)
  })

  it('request transitions: only payee = me, only from issued', async () => {
    await issueInvoice(db, newInvoice('a'))
    expect((await requestInvoice(db, 'a', at(2))).status).toBe('requested')
    await expect(requestInvoice(db, 'a', at(3))).rejects.toBeInstanceOf(Conflict)
    await issueInvoice(db, newInvoice('c', { payerId: 'me', payeeId: 'coned' }))
    await expect(requestInvoice(db, 'c', at(3))).rejects.toBeInstanceOf(Conflict)
    await voidInvoice(db, 'a', at(4))
    await expect(voidInvoice(db, 'a', at(5))).rejects.toBeInstanceOf(Conflict)
  })

  it('accounts are independent per roommate', async () => {
    await issueInvoice(db, newInvoice('a', { payerId: 'sam' }))
    await issueInvoice(db, newInvoice('b', { payerId: 'alex' }))
    await recordPayment(db, newPayment('p1', { payerId: 'alex', amountCents: 10000 }))
    expect(await state(db, 'a')).toEqual(['unpaid', 0])
    expect(await state(db, 'b')).toEqual(['paid', 10000])
    await assertConsistent(db)
  })

  it('statement has a running balance', async () => {
    await issueInvoice(db, newInvoice('a', { amountCents: 10000, issuedAt: at(1) }))
    await recordPayment(db, newPayment('p1', { amountCents: 4000, paidAt: at(2) }))
    const lines = await statement(db, acct.receivable('sam'))
    expect(lines.map(l => [l.amountCents, l.balanceCents])).toEqual([
      [10000, 10000],
      [-4000, 6000]
    ])
    const ranged = await statement(db, acct.receivable('sam'), { from: at(2) })
    expect(ranged.map(l => l.balanceCents)).toEqual([6000])
    expect(await balance(db, acct.receivable('sam'), at(1))).toBe(10000)
  })
})

describe('provider payable FIFO', () => {
  it('ConEd bills me, I pay via provider_portal', async () => {
    await issueInvoice(db, newInvoice('c1', { payerId: 'me', payeeId: 'coned', amountCents: 12000, issuedAt: at(1) }))
    await issueInvoice(db, newInvoice('c2', { payerId: 'me', payeeId: 'coned', amountCents: 9000, issuedAt: at(2) }))
    expect(await balance(db, acct.payable('coned'))).toBe(-21000)
    await recordPayment(
      db,
      newPayment('pp', { payerId: 'me', payeeId: 'coned', amountCents: 15000, method: 'provider_portal' })
    )
    expect(await state(db, 'c1')).toEqual(['paid', 12000])
    expect(await state(db, 'c2')).toEqual(['partially_paid', 3000])
    expect(await balance(db, acct.payable('coned'))).toBe(-6000)
    expect(await balance(db, acct.cash)).toBe(-15000)
    await assertConsistent(db)
  })

  it('expense nets to my own share after invoicing roommates', async () => {
    await issueInvoice(db, newInvoice('c1', { payerId: 'me', payeeId: 'coned', amountCents: 9000 }))
    await issueInvoice(db, newInvoice('s1', { payerId: 'sam', amountCents: 3000 }))
    await issueInvoice(db, newInvoice('s2', { payerId: 'alex', amountCents: 3000 }))
    expect(await balance(db, acct.expense('utilities'))).toBe(3000)
    await assertConsistent(db)
  })
})
