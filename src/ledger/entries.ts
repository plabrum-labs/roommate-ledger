import { defineEntry } from '@/framework/ledger'
import type { InvoiceWithLines } from '@/domain/invoice'
import type { Payment } from '@/domain/payment'
import type { ENTRY_KINDS } from '@/db/schema'

import { acct, ME } from './accounts'

export const entries = {
  invoiceIssued: defineEntry({
    source: 'invoice',
    occurredAt: (inv: InvoiceWithLines) => inv.issuedAt,
    // One transfer per line item, so each line lands on its own expense account.
    transfers: (inv: InvoiceWithLines) =>
      inv.lineItems.map(line =>
        inv.payeeId === ME
          ? { debit: acct.receivable(inv.payerId), credit: acct.expense(line.category), amountCents: line.amountCents }
          : { debit: acct.expense(line.category), credit: acct.payable(inv.payeeId), amountCents: line.amountCents }
      )
  }),
  payment: defineEntry({
    source: 'payment',
    occurredAt: (p: Payment) => p.paidAt,
    transfers: (p: Payment) =>
      p.payeeId === ME
        ? [{ debit: acct.cash, credit: acct.receivable(p.payerId), amountCents: p.amountCents }]
        : [{ debit: acct.payable(p.payeeId), credit: acct.cash, amountCents: p.amountCents }]
  })
}

export type EntryKind = keyof typeof entries

// Compile-time check: the schema's `kind` enum equals the registry keys.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
export const _kindsMatchSchema: Equal<EntryKind, (typeof ENTRY_KINDS)[number]> = true
