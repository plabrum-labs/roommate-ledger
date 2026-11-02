import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getInvoiceWithLines } from '@/domain/services'
import { ledger } from '@/ledger'
import { assertConsistent } from '@/testing/helpers'

import { connectTestClient } from './test-support'

type Harness = Awaited<ReturnType<typeof connectTestClient>>
let h: Harness

beforeEach(async () => {
  h = await connectTestClient()
})
afterEach(async () => {
  await h.close()
})

interface WithId {
  id: string
}
const bill = (id: string, amountCents: number): Record<string, unknown> => ({
  id,
  providerId: 'coned',
  description: `ConEd ${id}`,
  dueDate: '2026-03-01',
  issuedAt: '2026-01-01T00:00:00Z',
  lineItems: [{ description: 'Electric', category: 'utilities', amountCents }]
})
const split = (ids: string[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  providerInvoiceIds: ids,
  roommateIds: ['sam', 'alex'],
  dueDate: '2026-04-01',
  issuedAt: '2026-01-10T00:00:00Z',
  ...extra
})

describe('registration', () => {
  it('exposes exactly the intended tools, with annotations', async () => {
    const { tools } = await h.client.listTools()
    const byName = new Map(tools.map(t => [t.name, t.annotations]))
    expect([...byName.keys()].sort()).toEqual(
      [
        'create_invoice',
        'create_party',
        'create_roommate_invoices',
        'create_split_invoices',
        'get_balances',
        'get_invoice',
        'get_posting',
        'get_statement',
        'list_invoices',
        'list_parties',
        'list_payments',
        'preview_split',
        'record_payment',
        'record_provider_bill',
        'request_invoice',
        'void_invoice',
        'whoami'
      ].sort()
    )
    for (const name of [
      'whoami',
      'list_parties',
      'get_balances',
      'get_statement',
      'get_posting',
      'list_invoices',
      'get_invoice',
      'list_payments',
      'preview_split'
    ]) {
      expect(byName.get(name)).toMatchObject({ readOnlyHint: true })
    }
    for (const name of [
      'create_party',
      'create_invoice',
      'create_roommate_invoices',
      'record_payment',
      'record_provider_bill',
      'request_invoice',
      'create_split_invoices',
      'void_invoice'
    ]) {
      expect(byName.get(name)).toMatchObject({ readOnlyHint: false })
    }
    expect(byName.get('void_invoice')).toMatchObject({ destructiveHint: true })
    expect(byName.get('record_payment')).toMatchObject({ destructiveHint: false, idempotentHint: true })
    expect(byName.get('create_split_invoices')).toMatchObject({ destructiveHint: false, idempotentHint: true })
    expect(byName.has('void_payment')).toBe(false)
  })

  it('carries instructions about confirming writes', () => {
    expect(h.client.getInstructions()).toMatch(/Confirm the details with the user before calling any write tool/)
  })

  it('describes money as integer cents on every cents field', async () => {
    const { tools } = await h.client.listTools()
    for (const tool of tools) {
      const props = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>
      for (const [key, schema] of Object.entries(props)) {
        if (key.endsWith('Cents')) expect(schema.description, `${tool.name}.${key}`).toMatch(/integer cents/)
      }
    }
  })
})

describe('reads', () => {
  it('whoami and list_parties', async () => {
    expect(await h.callTool('whoami')).toEqual({
      email: null,
      me: { id: 'me', name: 'Me', kind: 'me', venmoHandle: null }
    })
    const { parties } = (await h.callTool('list_parties')) as { parties: WithId[] }
    expect(parties.map(p => p.id).sort()).toEqual(['alex', 'coned', 'me', 'sam'])
  })

  it('walks a bill through split, balances (with Venmo link), statement, posting and payments', async () => {
    await h.callTool('record_provider_bill', bill('c1', 9000))
    const preview = (await h.callTool('preview_split', split(['c1']))) as {
      totalCents: number
      myShareCents: number
      drafts: unknown[]
    }
    expect(preview).toMatchObject({ totalCents: 9000, myShareCents: 3000 })
    expect(preview.drafts).toHaveLength(2)
    await h.callTool('create_split_invoices', {
      ...split(['c1']),
      batchId: 'b1',
      expectedTotalCents: 9000,
      expectedDraftCount: 2
    })

    const balances = (await h.callTool('get_balances')) as {
      roommates: { partyId: string; balanceCents: number; venmoRequestUrl: string | null }[]
      totalOwedToMeCents: number
      totalIOweCents: number
    }
    expect(balances.totalOwedToMeCents).toBe(6000)
    expect(balances.totalIOweCents).toBe(9000)
    expect(balances.roommates.find(r => r.partyId === 'sam')?.venmoRequestUrl).toContain('venmo.com/?txn=charge')

    const stmt = (await h.callTool('get_statement', { partyId: 'sam' })) as {
      accountId: string
      closingBalanceCents: number
      lines: { entryGroupId: string }[]
    }
    expect(stmt).toMatchObject({ accountId: 'receivable:sam', closingBalanceCents: 3000 })
    const byAccount = await h.callTool('get_statement', { accountId: 'receivable:sam' })
    expect(byAccount).toEqual(stmt)
    expect(await h.callTool('get_statement', { partyId: 'coned' })).toMatchObject({
      accountId: 'payable:coned',
      closingBalanceCents: 9000
    })
    const windowed = (await h.callTool('get_statement', { partyId: 'sam', to: '2026-01-01T00:00:00Z' })) as {
      lines: unknown[]
    }
    expect(windowed.lines).toHaveLength(0)

    const posting = await h.callTool('get_posting', { entryGroupId: stmt.lines[0]?.entryGroupId })
    expect(posting).toMatchObject({ balanced: true })

    const { invoices } = (await h.callTool('list_invoices', { direction: 'outgoing' })) as { invoices: WithId[] }
    expect(invoices).toHaveLength(2)
    expect(await h.callTool('get_invoice', { id: invoices[0]?.id })).toMatchObject({ lineCount: 1, status: 'issued' })

    await h.callTool('record_payment', { id: 'p1', payerId: 'sam', payeeId: 'me', amountCents: 1000, method: 'venmo' })
    const { payments } = (await h.callTool('list_payments', { partyId: 'sam' })) as { payments: WithId[] }
    expect(payments.map(p => p.id)).toEqual(['p1'])
    expect(((await h.callTool('list_payments', { partyId: 'alex' })) as { payments: unknown[] }).payments).toEqual([])
    await assertConsistent(h.db)
  })

  it('rejects ambiguous or unknown statement requests', async () => {
    expect(await h.callTool('get_statement', {}, { allowError: true })).toMatchObject({ isError: true })
    expect(
      await h.callTool('get_statement', { partyId: 'sam', accountId: 'cash' }, { allowError: true })
    ).toMatchObject({ isError: true })
    expect(await h.callTool('get_statement', { partyId: 'nobody' }, { allowError: true })).toMatchObject({
      isError: true
    })
    expect(await h.callTool('get_invoice', { id: 'nope' }, { allowError: true })).toMatchObject({
      isError: true,
      text: expect.stringContaining('Not found') as unknown
    })
  })
})

describe('record_payment', () => {
  const payment = { id: 'p1', payerId: 'sam', payeeId: 'me', amountCents: 2500, method: 'venmo' }

  it('is idempotent on id and conflicts on different details', async () => {
    await h.callTool('record_provider_bill', bill('c1', 9000))
    await h.callTool('create_split_invoices', {
      ...split(['c1']),
      batchId: 'b1',
      expectedTotalCents: 9000,
      expectedDraftCount: 2
    })
    const first = await h.callTool('record_payment', payment)
    expect(await h.callTool('record_payment', payment)).toEqual(first)
    expect(((await h.callTool('list_payments')) as { payments: unknown[] }).payments).toHaveLength(1)
    const conflict = await h.callTool('record_payment', { ...payment, amountCents: 2600 }, { allowError: true })
    expect(conflict).toMatchObject({ isError: true })
    expect(await h.callTool('get_balances')).toMatchObject({ totalOwedToMeCents: 3500 })
    await assertConsistent(h.db)
  })

  it('requires an explicit id and integer cents', async () => {
    const { id: _id, ...noId } = payment
    expect(await h.callTool('record_payment', noId, { allowError: true })).toMatchObject({ isError: true })
    expect(await h.callTool('record_payment', { ...payment, amountCents: 12.5 }, { allowError: true })).toMatchObject({
      isError: true
    })
  })
})

describe('record_provider_bill and request_invoice', () => {
  it('records a bill, refuses a reused id, and marks a roommate invoice requested', async () => {
    const created = (await h.callTool('record_provider_bill', bill('c1', 9000))) as {
      payerId: string
      payeeId: string
      amountCents: number
    }
    expect(created).toMatchObject({ payerId: 'me', payeeId: 'coned', amountCents: 9000 })
    expect(await h.callTool('record_provider_bill', bill('c1', 9000), { allowError: true })).toMatchObject({
      isError: true
    })
    await h.callTool('create_split_invoices', {
      ...split(['c1']),
      batchId: 'b1',
      expectedTotalCents: 9000,
      expectedDraftCount: 2
    })
    const { invoices } = (await h.callTool('list_invoices', { direction: 'outgoing' })) as { invoices: WithId[] }
    const id = invoices[0]?.id
    expect(await h.callTool('request_invoice', { id })).toMatchObject({ status: 'requested' })
    expect(await h.callTool('request_invoice', { id }, { allowError: true })).toMatchObject({ isError: true })
  })
})

describe('create_split_invoices', () => {
  beforeEach(async () => {
    await h.callTool('record_provider_bill', bill('c1', 9000))
  })
  const args = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...split(['c1']),
    batchId: 'b1',
    expectedTotalCents: 9000,
    expectedDraftCount: 2,
    ...over
  })
  const outgoing = async (): Promise<number> =>
    ((await h.callTool('list_invoices', { direction: 'outgoing' })) as { invoices: unknown[] }).invoices.length

  it('rejects mismatched expectations without creating anything', async () => {
    expect(
      await h.callTool('create_split_invoices', args({ expectedTotalCents: 9001 }), { allowError: true })
    ).toMatchObject({
      isError: true,
      text: expect.stringContaining('preview_split') as unknown
    })
    expect(
      await h.callTool('create_split_invoices', args({ expectedDraftCount: 3 }), { allowError: true })
    ).toMatchObject({ isError: true })
    expect(await outgoing()).toBe(0)
  })

  it('requires the batchId and expectations', async () => {
    const { batchId: _b, ...noBatch } = args()
    expect(await h.callTool('create_split_invoices', noBatch, { allowError: true })).toMatchObject({ isError: true })
    const { expectedTotalCents: _t, ...noTotal } = args()
    expect(await h.callTool('create_split_invoices', noTotal, { allowError: true })).toMatchObject({ isError: true })
  })

  it('is idempotent on batchId and conflicts on a different request', async () => {
    const first = (await h.callTool('create_split_invoices', args())) as { invoices: WithId[] }
    expect(first.invoices).toHaveLength(2)
    const replay = (await h.callTool('create_split_invoices', args())) as { invoices: WithId[] }
    expect(replay.invoices.map(i => i.id)).toEqual(first.invoices.map(i => i.id))
    expect(await outgoing()).toBe(2)
    expect(
      await h.callTool('create_split_invoices', args({ roommateIds: ['sam'], expectedDraftCount: 1 }), {
        allowError: true
      })
    ).toMatchObject({ isError: true })
    expect(await outgoing()).toBe(2)
    await assertConsistent(h.db)
  })
})

describe('void_invoice', () => {
  let id: string
  beforeEach(async () => {
    await h.callTool('record_provider_bill', bill('c1', 9000))
    await h.callTool('create_split_invoices', {
      ...split(['c1']),
      batchId: 'b1',
      expectedTotalCents: 9000,
      expectedDraftCount: 2
    })
    const { invoices } = (await h.callTool('list_invoices', { direction: 'outgoing' })) as { invoices: WithId[] }
    id = invoices[0]?.id ?? ''
  })

  it('needs confirmInvoiceId === id and the right amount', async () => {
    expect(
      await h.callTool(
        'void_invoice',
        { id, confirmInvoiceId: 'other', expectedAmountCents: 3000 },
        { allowError: true }
      )
    ).toMatchObject({ isError: true })
    expect(
      await h.callTool('void_invoice', { id, confirmInvoiceId: id, expectedAmountCents: 3001 }, { allowError: true })
    ).toMatchObject({ isError: true })
    expect(await h.callTool('get_invoice', { id })).toMatchObject({ status: 'issued' })
    const voided = await h.callTool('void_invoice', { id, confirmInvoiceId: id, expectedAmountCents: 3000 })
    expect(voided).toMatchObject({ status: 'void', settlement: null })
    expect(
      await h.callTool('void_invoice', { id, confirmInvoiceId: id, expectedAmountCents: 3000 }, { allowError: true })
    ).toMatchObject({ isError: true })
    expect(await h.callTool('get_balances')).toMatchObject({ totalOwedToMeCents: 3000 })
    await assertConsistent(h.db)
  })
})

describe('create_party', () => {
  it('adds roommates and providers, and refuses a second me or a reused id', async () => {
    expect(await h.callTool('create_party', { id: 'verizon', name: 'Verizon', kind: 'provider' })).toEqual({
      id: 'verizon',
      name: 'Verizon',
      kind: 'provider',
      venmoHandle: null
    })
    expect(
      await h.callTool('create_party', { id: 'jo', name: 'Jo', kind: 'roommate', venmoHandle: 'jo-v' })
    ).toMatchObject({ kind: 'roommate', venmoHandle: 'jo-v' })
    const generated = (await h.callTool('create_party', { name: 'Gas Co', kind: 'provider' })) as WithId
    expect(generated.id).not.toBe('')
    expect(
      await h.callTool('create_party', { id: 'verizon', name: 'Verizon', kind: 'provider' }, { allowError: true })
    ).toMatchObject({ isError: true })
    expect(await h.callTool('create_party', { name: 'Me 2', kind: 'me' }, { allowError: true })).toMatchObject({
      isError: true
    })
    const { parties } = (await h.callTool('list_parties')) as { parties: WithId[] }
    expect(parties.map(p => p.id)).toEqual(expect.arrayContaining(['verizon', 'jo', generated.id]))
  })
})

describe('create_invoice', () => {
  const charge = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'g1',
    payerId: 'sam',
    payeeId: 'me',
    description: 'Groceries',
    dueDate: '2026-03-01',
    issuedAt: '2026-01-01T00:00:00Z',
    lineItems: [{ description: 'Costco run', category: 'groceries', amountCents: 2450 }],
    ...extra
  })

  it('creates a one-off roommate charge and rejects a reused id or an illegal direction', async () => {
    expect(await h.callTool('create_invoice', charge())).toMatchObject({
      id: 'g1',
      amountCents: 2450,
      status: 'issued'
    })
    expect(await h.callTool('create_invoice', charge(), { allowError: true })).toMatchObject({ isError: true })
    expect(
      await h.callTool('create_invoice', charge({ id: 'g2', payerId: 'sam', payeeId: 'alex' }), { allowError: true })
    ).toMatchObject({ isError: true })
    expect(await h.callTool('get_balances')).toMatchObject({ totalOwedToMeCents: 2450 })
    await assertConsistent(h.db)
  })
})

describe('create_roommate_invoices', () => {
  const batch = (batchId?: string): Record<string, unknown> => ({
    ...(batchId === undefined ? {} : { batchId }),
    invoices: ['sam', 'alex'].map(payerId => ({
      payerId,
      description: 'Furniture',
      dueDate: '2026-03-01',
      issuedAt: '2026-01-01T00:00:00Z',
      lineItems: [{ description: 'Couch share', category: 'household', amountCents: 10000 }]
    }))
  })

  it('creates all invoices at once and replays on batchId', async () => {
    const first = (await h.callTool('create_roommate_invoices', batch('f1'))) as { invoices: WithId[] }
    expect(first.invoices).toHaveLength(2)
    const replay = (await h.callTool('create_roommate_invoices', batch('f1'))) as { invoices: WithId[] }
    expect(replay.invoices.map(i => i.id).sort()).toEqual(first.invoices.map(i => i.id).sort())
    expect(await h.callTool('get_balances')).toMatchObject({ totalOwedToMeCents: 20000 })
    await assertConsistent(h.db)
  })
})

describe('large invoices (D1 allows 100 bound parameters per statement)', () => {
  const LINES = 40
  const big = {
    id: 'big',
    payerId: 'sam',
    payeeId: 'me',
    description: 'Many lines',
    dueDate: '2026-03-01',
    issuedAt: '2026-01-01T00:00:00Z',
    lineItems: Array.from({ length: LINES }, (_, i) => ({
      description: `Line ${String(i)}`,
      category: `cat${String(i)}`,
      amountCents: 100 + i
    }))
  }
  const total = big.lineItems.reduce((s, l) => s + l.amountCents, 0)
  const entryCount = async (): Promise<number> => {
    const [row] = await h.db.all<{ n: number }>(sql`SELECT count(*) AS n FROM ledger_entries WHERE invoice_id = 'big'`)
    return row?.n ?? 0
  }

  it('creates, re-posts idempotently, and voids an invoice whose posting spans several statements', async () => {
    expect(await h.callTool('create_invoice', big)).toMatchObject({ amountCents: total, status: 'issued' })
    expect(((await h.callTool('get_invoice', { id: 'big' })) as { lineItems: unknown[] }).lineItems).toHaveLength(LINES)
    expect(await entryCount()).toBe(LINES * 2)

    // Posting again (a new entry group) must insert nothing, even though the original group was written in chunks.
    const doc = await getInvoiceWithLines(h.db, 'big')
    await h.db.batch(ledger(h.db).post('invoiceIssued', doc))
    expect(await entryCount()).toBe(LINES * 2)
    expect(await h.callTool('get_balances')).toMatchObject({ totalOwedToMeCents: total })

    await h.callTool('void_invoice', { id: 'big', confirmInvoiceId: 'big', expectedAmountCents: total })
    expect(await entryCount()).toBe(LINES * 4)
    // Reversing again inserts nothing.
    await h.db.batch(ledger(h.db).reverse('invoiceIssued', doc))
    expect(await entryCount()).toBe(LINES * 4)
    expect(await h.callTool('get_balances')).toMatchObject({ totalOwedToMeCents: 0 })
    await assertConsistent(h.db)
  })

  it('records a provider bill with many lines', async () => {
    const { payerId: _p, payeeId: _q, ...rest } = big
    expect(await h.callTool('record_provider_bill', { ...rest, id: 'bigbill', providerId: 'coned' })).toMatchObject({
      amountCents: total
    })
    await assertConsistent(h.db)
  })
})
