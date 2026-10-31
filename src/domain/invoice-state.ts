import { ME } from '@/ledger/accounts'

import { Conflict } from './errors'
import type { Invoice, InvoiceStatus } from './invoice'

export const transitions = {
  issued: ['requested', 'void'],
  requested: ['void'],
  void: []
} as const satisfies Record<InvoiceStatus, readonly InvoiceStatus[]>

export function allowedTransitions(invoice: Pick<Invoice, 'status' | 'payeeId'>): readonly InvoiceStatus[] {
  return transitions[invoice.status].filter(to => to !== 'requested' || invoice.payeeId === ME)
}

export function assertAllowed(invoice: Pick<Invoice, 'status' | 'payeeId'>, to: InvoiceStatus): void {
  if (!allowedTransitions(invoice).includes(to)) {
    throw new Conflict(`Cannot move invoice from ${invoice.status} to ${to}`)
  }
}
