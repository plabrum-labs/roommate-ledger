import { beforeEach, describe, expect, it } from 'vitest'

import type { Db } from '@/db/client'
import { ME } from '@/ledger'
import { assertConsistent, freshDb } from '@/testing/helpers'

import type { Ctx } from './context'
import { handleApi } from './router'
import type {
  Balances,
  InvoiceBatchResult,
  InvoiceDetail,
  SplitPreview,
  Party,
  Payment,
  Posting,
  SplitResult,
  Statement
} from './schemas'

let db: Db
let ctx: Ctx

beforeEach(async () => {
  db = await freshDb()
  ctx = { db, me: ME }
})

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await handleApi(
    new Request(`http://x/api${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }),
    ctx
  )
  if (!res) throw new Error(`unmatched ${method} ${path}`)
  return res
}

async function ok<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await call(method, path, body)
  expect(res.status, await res.clone().text()).toBeLessThan(300)
  return res.json()
}

const providerBill = (id: string, amountCents: number, issuedAt: string): Promise<InvoiceDetail> =>
  ok('POST', '/invoices', {
    id,
    payerId: 'me',
    payeeId: 'coned',
    description: `ConEd ${id}`,
    lineItems: [{ description: `ConEd ${id}`, category: 'utilities', amountCents }],
    issuedAt,
    dueDate: '2026-03-01'
  })

async function split(ids: string[], roommateIds = ['sam', 'alex']): Promise<SplitResult> {
  return ok('POST', '/invoices/split', {
    providerInvoiceIds: ids,
    roommateIds,
    dueDate: '2026-04-01',
    issuedAt: '2026-01-10T00:00:00Z'
  })
}

describe('parties', () => {
  it('creates and lists', async () => {
    const created = await ok<Party>('POST', '/parties', { id: 'jo', name: 'Jo', kind: 'roommate', venmoHandle: 'jo-v' })
    expect(created).toEqual({ id: 'jo', name: 'Jo', kind: 'roommate', venmoHandle: 'jo-v' })
    const all = await ok<Party[]>('GET', '/parties')
    expect(all.map(p => p.id).sort()).toEqual(['alex', 'coned', 'jo', 'me', 'sam'])
  })

  it('rejects duplicates (409) and kind "me" (400)', async () => {
    expect((await call('POST', '/parties', { id: 'sam', name: 'Sam2', kind: 'roommate' })).status).toBe(409)
    expect((await call('POST', '/parties', { name: 'X', kind: 'me' })).status).toBe(400)
  })
})

describe('invoices and split', () => {
  it('splits provider bills equally across roommates and me, in one go', async () => {
    await providerBill('c1', 10000, '2026-01-01T00:00:00Z')
    await providerBill('c2', 5001, '2026-02-01T00:00:00Z')
    const result = await split(['c1', 'c2'])
    expect(result.totalCents).toBe(15001)
    expect(result.invoices.map(i => i.amountCents)).toEqual([5001, 5000])
    expect(result.myShareCents).toBe(5000)
    expect(result.invoices.map(i => i.payerId)).toEqual(['sam', 'alex'])
    expect(result.invoices.every(i => i.payeeId === 'me' && i.settlement === 'unpaid')).toBe(true)
    await assertConsistent(db)
  })

  it('splits per line so categories survive, one combined invoice per roommate, with extra lines', async () => {
    await ok('POST', '/invoices', {
      id: 'c1',
      payerId: 'me',
      payeeId: 'coned',
      description: 'ConEd Jul',
      lineItems: [
        { description: 'Electric', category: 'utilities', amountCents: 9000 },
        { description: 'Gas', category: 'gas', amountCents: 4000 }
      ],
      issuedAt: '2026-01-01T00:00:00Z',
      dueDate: '2026-03-01'
    })
    await providerBill('c2', 5001, '2026-02-01T00:00:00Z')
    const body = {
      providerInvoiceIds: ['c1', 'c2'],
      roommateIds: ['sam', 'alex'],
      dueDate: '2026-04-01',
      issuedAt: '2026-01-10T00:00:00Z',
      extraLines: [{ roommateId: 'alex', description: 'Groceries', category: 'groceries', amountCents: 1234 }]
    }
    const preview = await ok<SplitPreview>('POST', '/invoices/split/preview', body)
    expect(await ok<InvoiceDetail[]>('GET', '/invoices?direction=outgoing')).toHaveLength(0)
    expect(preview.totalCents).toBe(18001)
    expect(preview.drafts.map(d => d.payerId)).toEqual(['sam', 'alex'])
    const [sam, alex] = preview.drafts
    expect(sam?.lineItems.map(l => [l.description, l.category])).toEqual([
      ['ConEd Jul share (Electric)', 'utilities'],
      ['ConEd Jul share (Gas)', 'gas'],
      ['ConEd c2 share', 'utilities']
    ])
    expect(alex?.lineItems.at(-1)).toEqual({ description: 'Groceries', category: 'groceries', amountCents: 1234 })
    // Each bill's cents are exact: roommate shares plus mine equal the bill totals.
    const billShares = (d: SplitPreview['drafts'][number] | undefined): number =>
      (d?.lineItems ?? []).filter(l => l.category !== 'groceries').reduce((a, l) => a + l.amountCents, 0)
    expect(billShares(sam) + billShares(alex) + preview.myShareCents).toBe(18001)
    expect(sam?.totalCents).toBe(billShares(sam))
    expect(alex?.totalCents).toBe(billShares(alex) + 1234)

    const result = await ok<SplitResult>('POST', '/invoices/split', body)
    expect(result.invoices.map(i => [i.payerId, i.amountCents, i.lineCount])).toEqual(
      preview.drafts.map(d => [d.payerId, d.totalCents, d.lineItems.length])
    )
    const detail = await ok<InvoiceDetail>('GET', `/invoices/${result.invoices[1]?.id}`)
    expect(detail.lineItems.map(l => l.position)).toEqual([0, 1, 2, 3])
    expect(detail.lineItems.map(l => l.amountCents)).toEqual(alex?.lineItems.map(l => l.amountCents))
    // Payable of the bills and the receivables net out per category.
    const expenses = await ok<Statement>('GET', '/accounts/expense:groceries/statement')
    expect(expenses.closingBalanceCents).toBe(-1234)
    await assertConsistent(db)
  })

  it('rejects extra lines for roommates that are not selected', async () => {
    await providerBill('c1', 9000, '2026-01-01T00:00:00Z')
    const res = await call('POST', '/invoices/split/preview', {
      providerInvoiceIds: ['c1'],
      roommateIds: ['sam'],
      dueDate: '2026-04-01',
      extraLines: [{ roommateId: 'alex', description: 'x', category: 'groceries', amountCents: 100 }]
    })
    expect(res.status).toBe(400)
  })

  it('creates edited drafts in one batch, all or nothing', async () => {
    await providerBill('c1', 9000, '2026-01-01T00:00:00Z')
    const preview = await ok<SplitPreview>('POST', '/invoices/split/preview', {
      providerInvoiceIds: ['c1'],
      roommateIds: ['sam', 'alex'],
      dueDate: '2026-04-01'
    })
    const edited = preview.drafts.map(d => ({
      payerId: d.payerId,
      description: d.description,
      dueDate: d.dueDate,
      lineItems: [...d.lineItems, { description: 'Groceries', category: 'groceries', amountCents: 500 }]
    }))
    const created = await ok<InvoiceBatchResult>('POST', '/invoices/batch', { invoices: edited })
    expect(created.invoices.map(i => i.amountCents)).toEqual([3500, 3500])
    expect(created.invoices.map(i => i.lineCount)).toEqual([2, 2])
    const bad = [...edited, { ...edited[0], payerId: 'coned' }]
    expect((await call('POST', '/invoices/batch', { invoices: bad })).status).toBe(400)
    expect(await ok<InvoiceDetail[]>('GET', '/invoices?direction=outgoing')).toHaveLength(2)
    await assertConsistent(db)
  })

  it('lists with direction/status/settlement filters', async () => {
    await providerBill('c1', 9000, '2026-01-01T00:00:00Z')
    const { invoices } = await split(['c1'])
    const outgoing = await ok<InvoiceDetail[]>('GET', '/invoices?direction=outgoing')
    expect(outgoing).toHaveLength(2)
    expect(await ok<InvoiceDetail[]>('GET', '/invoices?direction=incoming')).toHaveLength(1)
    await ok('POST', `/invoices/${invoices[0]?.id}/request`)
    expect(await ok<InvoiceDetail[]>('GET', '/invoices?status=requested')).toHaveLength(1)
    expect(await ok<InvoiceDetail[]>('GET', '/invoices?settlement=unpaid&direction=outgoing')).toHaveLength(2)
    expect((await call('GET', '/invoices?status=bogus')).status).toBe(400)
  })

  it('shows transitions and hides stale settlement on void invoices', async () => {
    await providerBill('c1', 9000, '2026-01-01T00:00:00Z')
    const { invoices } = await split(['c1'], ['sam'])
    const id = invoices[0]?.id ?? ''
    await ok('POST', '/payments', { id: 'p1', payerId: 'sam', payeeId: 'me', amountCents: 2000, method: 'venmo' })
    const partial = await ok<InvoiceDetail>('GET', `/invoices/${id}`)
    expect(partial).toMatchObject({ settlement: 'partially_paid', appliedCents: 2000, remainingCents: 2500 })
    await ok('POST', `/invoices/${id}/request`)
    const voided = await ok<InvoiceDetail>('POST', `/invoices/${id}/void`)
    expect(voided).toMatchObject({ status: 'void', settlement: null, appliedCents: 0, remainingCents: 0 })
    expect(voided.allowedTransitions).toEqual([])
    expect(voided.transitions.map(t => `${t.fromStatus}>${t.toStatus}`)).toEqual(['issued>requested', 'requested>void'])
    await assertConsistent(db)
  })

  it('409 on second void and on requesting an incoming invoice', async () => {
    await providerBill('c1', 9000, '2026-01-01T00:00:00Z')
    const { invoices } = await split(['c1'], ['sam'])
    const id = invoices[0]?.id ?? ''
    await ok('POST', `/invoices/${id}/void`)
    expect((await call('POST', `/invoices/${id}/void`)).status).toBe(409)
    expect((await call('POST', '/invoices/c1/request')).status).toBe(409)
  })

  it('rejects invalid input (400) and unknown ids (404)', async () => {
    expect((await call('POST', '/invoices', { amountCents: -5 })).status).toBe(400)
    const base = { payerId: 'sam', payeeId: 'me', description: 'x', dueDate: '2026-04-01' }
    expect((await call('POST', '/invoices', { ...base, lineItems: [] })).status).toBe(400)
    expect(
      (
        await call('POST', '/invoices', {
          ...base,
          lineItems: [{ description: 'x', category: 'utilities', amountCents: 0 }]
        })
      ).status
    ).toBe(400)
    expect(
      (
        await call('POST', '/invoices', {
          payerId: 'sam',
          payeeId: 'alex',
          description: 'x',
          lineItems: [{ description: 'x', category: 'utilities', amountCents: 100 }],
          dueDate: '2026-04-01'
        })
      ).status
    ).toBe(400)
    expect(
      (await call('POST', '/invoices/split', { providerInvoiceIds: [], roommateIds: ['sam'], dueDate: '2026-04-01' }))
        .status
    ).toBe(400)
    expect(
      (
        await call('POST', '/invoices/split', {
          providerInvoiceIds: ['nope'],
          roommateIds: ['sam'],
          dueDate: '2026-04-01'
        })
      ).status
    ).toBe(404)
    expect((await call('GET', '/invoices/nope')).status).toBe(404)
    expect((await call('POST', '/invoices/nope/void')).status).toBe(404)
  })

  it('refuses to split a roommate invoice or a non-roommate', async () => {
    await providerBill('c1', 9000, '2026-01-01T00:00:00Z')
    const { invoices } = await split(['c1'], ['sam'])
    const body = (providerInvoiceIds: string[], roommateIds: string[]): unknown => ({
      providerInvoiceIds,
      roommateIds,
      dueDate: '2026-04-01'
    })
    expect((await call('POST', '/invoices/split', body([invoices[0]?.id ?? ''], ['alex']))).status).toBe(400)
    expect((await call('POST', '/invoices/split', body(['c1'], ['coned']))).status).toBe(400)
  })
})

describe('payments, balances, statement, posting', () => {
  async function scenario(): Promise<SplitResult> {
    await providerBill('c1', 10000, '2026-01-01T00:00:00Z')
    return split(['c1'])
  }

  it('balances start at 0 per roommate, rise on invoicing, and fall on payments (credit when over-paid)', async () => {
    const before = await ok<Balances>('GET', '/balances')
    expect(before.roommates.map(r => [r.partyId, r.balanceCents, r.venmoRequestUrl])).toEqual([
      ['alex', 0, null],
      ['sam', 0, null]
    ])

    await scenario()
    await ok('POST', '/payments', { id: 'p1', payerId: 'sam', payeeId: 'me', amountCents: 1000, method: 'venmo' })
    await ok('POST', '/payments', { id: 'p2', payerId: 'alex', payeeId: 'me', amountCents: 4000, method: 'zelle' })
    await ok('POST', '/payments', {
      id: 'p3',
      payerId: 'me',
      payeeId: 'coned',
      amountCents: 6000,
      method: 'provider_portal'
    })

    const after = await ok<Balances>('GET', '/balances')
    const sam = after.roommates.find(r => r.partyId === 'sam')
    const alex = after.roommates.find(r => r.partyId === 'alex')
    expect(sam?.balanceCents).toBe(2334)
    expect(sam?.venmoRequestUrl).toBe(
      'https://venmo.com/?txn=charge&audience=private&recipients=sam-v&amount=23.34&note=Utilities'
    )
    expect(alex?.balanceCents).toBe(-667)
    expect(alex?.venmoRequestUrl).toBeNull()
    expect(after.providers).toEqual([{ partyId: 'coned', name: 'ConEd', owedCents: 4000 }])
    expect(after.totalOwedToMeCents).toBe(2334)
    expect(after.totalIOweCents).toBe(4000)
    await assertConsistent(db)
  })

  it('payments are idempotent on id; conflicting replays are 409; bad directions are 400', async () => {
    await scenario()
    const body = { id: 'p1', payerId: 'sam', payeeId: 'me', amountCents: 1000, method: 'venmo' }
    const first = await ok<Payment>('POST', '/payments', body)
    const again = await ok<Payment>('POST', '/payments', body)
    expect(again).toEqual(first)
    expect((await call('POST', '/payments', { ...body, amountCents: 999 })).status).toBe(409)
    expect((await call('POST', '/payments', { ...body, id: 'p9', payerId: 'me', payeeId: 'sam' })).status).toBe(400)
    expect((await call('POST', '/payments', { ...body, id: 'p9', amountCents: 0 })).status).toBe(400)
    expect(await ok<Payment[]>('GET', '/payments')).toHaveLength(1)
    expect(await ok<Payment[]>('GET', '/payments?partyId=alex')).toHaveLength(0)
    expect(await ok<Payment[]>('GET', '/payments?partyId=sam')).toHaveLength(1)
    await assertConsistent(db)
  })

  it('statement has party-perspective signs and a running balance, flipped for payables', async () => {
    await scenario()
    await ok('POST', '/payments', {
      id: 'p1',
      payerId: 'sam',
      payeeId: 'me',
      amountCents: 1000,
      method: 'venmo',
      paidAt: '2026-02-01T00:00:00Z'
    })
    await ok('POST', '/payments', {
      id: 'p3',
      payerId: 'me',
      payeeId: 'coned',
      amountCents: 6000,
      method: 'provider_portal',
      paidAt: '2026-02-02T00:00:00Z'
    })

    const sam = await ok<Statement>('GET', '/accounts/receivable:sam/statement')
    expect(sam.partyId).toBe('sam')
    expect(sam.lines.map(l => [l.source.type, l.amountCents, l.balanceCents])).toEqual([
      ['invoice', 3334, 3334],
      ['payment', -1000, 2334]
    ])
    expect(sam.closingBalanceCents).toBe(2334)

    const ranged = await ok<Statement>(
      'GET',
      `/accounts/receivable:sam/statement?from=${encodeURIComponent('2026-01-15T00:00:00Z')}`
    )
    expect(ranged.lines.map(l => l.balanceCents)).toEqual([2334])

    const coned = await ok<Statement>('GET', '/accounts/payable:coned/statement')
    expect(coned.lines.map(l => [l.source.type, l.amountCents, l.balanceCents])).toEqual([
      ['invoice', 10000, 10000],
      ['payment', -6000, 4000]
    ])

    expect((await call('GET', '/accounts/receivable:ghost/statement')).status).toBe(404)
    expect((await call('GET', '/accounts/bogus/statement')).status).toBe(404)
  })

  it('posting lines balance, including a void reversal', async () => {
    const { invoices } = await scenario()
    const id = invoices[0]?.id ?? ''
    await ok('POST', `/invoices/${id}/void`)
    const stmt = await ok<Statement>('GET', `/accounts/receivable:${invoices[0]?.payerId}/statement`)
    expect(stmt.lines.map(l => [l.reversal, l.balanceCents])).toEqual([
      [false, 3334],
      [true, 0]
    ])
    expect(stmt.lines[1]?.description).toBe('Void: ConEd c1')
    for (const line of stmt.lines) {
      const p = await ok<Posting>('GET', `/postings/${line.entryGroupId}`)
      expect(p.balanced).toBe(true)
      expect(p.totalDebitCents).toBe(p.totalCreditCents)
      expect(p.lines.every(l => (l.debitCents === 0) !== (l.creditCents === 0))).toBe(true)
      expect(p.source).toMatchObject({ type: 'invoice', invoiceId: id })
    }
    expect((await call('GET', '/postings/nope')).status).toBe(404)
  })
})
