import { describe, expect, it } from 'vitest'

import type { InvoiceWithLines } from '@/domain/invoice'
import type { Payment } from '@/domain/payment'
import { diff, expand } from '@/framework/ledger'

import { ledger } from './index'
import { entries } from './entries'

const NOW = '2026-03-01T00:00:00Z'

const line = (category: string, amountCents: number, position = 0): InvoiceWithLines['lineItems'][number] => ({
  id: `l${position}`,
  invoiceId: 'i1',
  position,
  description: category,
  category,
  amountCents
})
const invoice = (o: Partial<InvoiceWithLines>): InvoiceWithLines => ({
  id: 'i1',
  payerId: 'sam',
  payeeId: 'me',
  amountCents: 5000,
  description: '',
  lineItems: [line('utilities', 5000)],
  issuedAt: NOW,
  dueDate: '2026-04-01',
  status: 'issued',
  settlement: 'unpaid',
  appliedCents: 0,
  ...o
})
const payment = (o: Partial<Payment>): Payment => ({
  id: 'p1',
  payerId: 'sam',
  payeeId: 'me',
  amountCents: 5000,
  paidAt: NOW,
  method: 'venmo',
  reference: null,
  ...o
})

describe('entry diffs', () => {
  it('roommate payment', () => {
    expect(diff(expand('payment', entries.payment, payment({}), NOW))).toEqual({
      'cash': 5000,
      'receivable:sam': -5000
    })
  })
  it('payment to provider', () => {
    expect(diff(expand('payment', entries.payment, payment({ payerId: 'me', payeeId: 'coned' }), NOW))).toEqual({
      'payable:coned': 5000,
      'cash': -5000
    })
  })
  it('invoice to roommate', () => {
    expect(diff(expand('invoiceIssued', entries.invoiceIssued, invoice({}), NOW))).toEqual({
      'receivable:sam': 5000,
      'expense:utilities': -5000
    })
  })
  it('provider invoice', () => {
    expect(
      diff(expand('invoiceIssued', entries.invoiceIssued, invoice({ payerId: 'me', payeeId: 'coned' }), NOW))
    ).toEqual({ 'expense:utilities': 5000, 'payable:coned': -5000 })
  })
  it('posts one transfer per line item, each to its own expense account', () => {
    const inv = invoice({ amountCents: 8000, lineItems: [line('utilities', 5000), line('groceries', 3000, 1)] })
    const lines = expand('invoiceIssued', entries.invoiceIssued, inv, NOW)
    expect(lines).toHaveLength(4)
    expect(diff(lines)).toEqual({ 'receivable:sam': 8000, 'expense:utilities': -5000, 'expense:groceries': -3000 })
    expect(Object.values(diff(lines)).reduce((a, b) => a + b, 0)).toBe(0)
  })
  it('provider invoice with two categories', () => {
    const inv = invoice({
      payerId: 'me',
      payeeId: 'coned',
      amountCents: 8000,
      lineItems: [line('utilities', 5000), line('internet', 3000, 1)]
    })
    expect(diff(expand('invoiceIssued', entries.invoiceIssued, inv, NOW))).toEqual({
      'expense:utilities': 5000,
      'expense:internet': 3000,
      'payable:coned': -8000
    })
  })
  it('void reverses exactly', () => {
    const inv = invoice({})
    const lines = [
      ...expand('invoiceIssued', entries.invoiceIssued, inv, NOW),
      ...expand('invoiceIssued', entries.invoiceIssued, inv, NOW, -1, 'g1')
    ]
    expect(Object.values(diff(lines)).every(v => v === 0)).toBe(true)
  })
  it('rejects non-positive amounts', () => {
    expect(() => expand('payment', entries.payment, payment({ amountCents: 0 }), NOW)).toThrow(RangeError)
  })
})

describe('types', () => {
  it('rejects a source of the wrong type', () => {
    const l = ledger({
      insert: () => {
        throw new Error('not called')
      }
    })
    const wrong = (): void => {
      // Must fail to compile: a payment entry takes a Payment, not an Invoice.
      // @ts-expect-error invoice is not a Payment
      l.post('payment', invoice({}))
      // @ts-expect-error unknown kind
      l.post('nope', invoice({}))
    }
    expect(wrong).toThrow()
  })
})
