import { z } from 'zod'

import { Invoice, InvoiceStatus, LineItem, NewInvoice, NewLineItem, Settlement } from '@/domain/invoice'
import { Party } from '@/domain/party'
import { Payment, PaymentMethod } from '@/domain/payment'

export { Party, Payment, PaymentMethod, InvoiceStatus, Settlement, LineItem, NewLineItem }

export const IdParam = z.object({ id: z.string().min(1) })
export type IdParam = z.infer<typeof IdParam>

// Parties

export const PartyCreate = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  kind: z.enum(['roommate', 'provider']),
  venmoHandle: z.string().min(1).nullable().default(null)
})
export type PartyCreate = z.infer<typeof PartyCreate>

// Invoices

/** An invoice as the API shows it. A void invoice has no meaningful settlement, so it is `null` and nothing is applied. */
export const InvoiceSummary = Invoice.omit({ settlement: true }).extend({
  settlement: Settlement.nullable(),
  remainingCents: z.number().int().nonnegative(),
  lineCount: z.number().int().positive()
})
export type InvoiceSummary = z.infer<typeof InvoiceSummary>

export const InvoiceTransition = z.object({
  fromStatus: InvoiceStatus,
  toStatus: InvoiceStatus,
  at: z.string(),
  note: z.string().nullable()
})
export type InvoiceTransition = z.infer<typeof InvoiceTransition>

export const InvoiceDetail = InvoiceSummary.extend({
  lineItems: z.array(LineItem),
  transitions: z.array(InvoiceTransition),
  /** Lifecycle moves legal from the current status. */
  allowedTransitions: z.array(InvoiceStatus)
})
export type InvoiceDetail = z.infer<typeof InvoiceDetail>

export const InvoiceListQuery = z.object({
  direction: z.enum(['incoming', 'outgoing']).optional(),
  status: InvoiceStatus.optional(),
  settlement: Settlement.optional()
})
export type InvoiceListQuery = z.infer<typeof InvoiceListQuery>

export const InvoiceCreate = NewInvoice.partial({ id: true, issuedAt: true })
export type InvoiceCreate = z.infer<typeof InvoiceCreate>

/** One roommate invoice to create (payee is always me); the unit of `createInvoices` and what a split preview returns. */
export const InvoiceDraft = z.object({
  payerId: z.string().min(1),
  description: z.string(),
  dueDate: z.iso.date(),
  /** Defaults to now. */
  issuedAt: z.iso.datetime().optional(),
  lineItems: NewInvoice.shape.lineItems
})
export type InvoiceDraft = z.infer<typeof InvoiceDraft>

export const InvoiceBatchCreate = z.object({ invoices: z.array(InvoiceDraft).min(1) })
export type InvoiceBatchCreate = z.infer<typeof InvoiceBatchCreate>

export const InvoiceBatchResult = z.object({ invoices: z.array(InvoiceDetail) })
export type InvoiceBatchResult = z.infer<typeof InvoiceBatchResult>

export const InvoiceSplit = z.object({
  providerInvoiceIds: z.array(z.string().min(1)).min(1),
  roommateIds: z.array(z.string().min(1)).min(1),
  /** Applies to every roommate's invoice; defaults to the bills' descriptions joined. */
  description: z.string().optional(),
  dueDate: z.iso.date(),
  /** Defaults to now; a backdated value keeps FIFO position. */
  issuedAt: z.iso.datetime().optional(),
  /** Manual lines (e.g. groceries) appended to the named roommate's invoice after their bill shares. */
  extraLines: z.array(NewLineItem.extend({ roommateId: z.string().min(1) })).default([])
})
export type InvoiceSplit = z.infer<typeof InvoiceSplit>

export const SplitDraft = InvoiceDraft.extend({
  issuedAt: z.iso.datetime(),
  totalCents: z.number().int().positive()
})
export type SplitDraft = z.infer<typeof SplitDraft>

export const SplitPreview = z.object({
  /** Sum of the selected provider bills; extra lines are not included. */
  totalCents: z.number().int(),
  myShareCents: z.number().int(),
  drafts: z.array(SplitDraft)
})
export type SplitPreview = z.infer<typeof SplitPreview>

export const SplitResult = z.object({
  totalCents: z.number().int(),
  myShareCents: z.number().int(),
  invoices: z.array(InvoiceSummary)
})
export type SplitResult = z.infer<typeof SplitResult>

// Payments

export const PaymentCreate = Payment.partial({ paidAt: true }).extend({
  reference: z.string().nullable().default(null)
})
export type PaymentCreate = z.infer<typeof PaymentCreate>

export const PaymentListQuery = z.object({ partyId: z.string().min(1).optional() })
export type PaymentListQuery = z.infer<typeof PaymentListQuery>

// Balances

export const RoommateBalance = z.object({
  partyId: z.string(),
  name: z.string(),
  venmoHandle: z.string().nullable(),
  /** What they owe me; negative is credit. */
  balanceCents: z.number().int(),
  /** Venmo charge deep link; only when they owe something and have a handle. */
  venmoRequestUrl: z.string().nullable()
})
export type RoommateBalance = z.infer<typeof RoommateBalance>

export const ProviderBalance = z.object({
  partyId: z.string(),
  name: z.string(),
  /** What I owe this provider. */
  owedCents: z.number().int()
})
export type ProviderBalance = z.infer<typeof ProviderBalance>

export const Balances = z.object({
  roommates: z.array(RoommateBalance),
  providers: z.array(ProviderBalance),
  totalOwedToMeCents: z.number().int(),
  totalIOweCents: z.number().int()
})
export type Balances = z.infer<typeof Balances>

// Ledger documents

export const LedgerSource = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('invoice'),
    invoiceId: z.string(),
    description: z.string(),
    status: InvoiceStatus
  }),
  z.object({
    type: z.literal('payment'),
    paymentId: z.string(),
    method: PaymentMethod,
    reference: z.string().nullable()
  })
])
export type LedgerSource = z.infer<typeof LedgerSource>

export const StatementQuery = z.object({
  id: z.string().min(1),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional()
})
export type StatementQuery = z.infer<typeof StatementQuery>

export const StatementLine = z.object({
  entryId: z.string(),
  entryGroupId: z.string(),
  occurredAt: z.string(),
  description: z.string(),
  /** Party perspective: positive means they owe more (receivables) / I owe more (payables). */
  amountCents: z.number().int(),
  balanceCents: z.number().int(),
  reversal: z.boolean(),
  source: LedgerSource
})
export type StatementLine = z.infer<typeof StatementLine>

export const Statement = z.object({
  accountId: z.string(),
  partyId: z.string().nullable(),
  partyName: z.string().nullable(),
  lines: z.array(StatementLine),
  /** Balance after the last returned line (0 when there are none and no earlier activity is known). */
  closingBalanceCents: z.number().int()
})
export type Statement = z.infer<typeof Statement>

export const PostingParam = z.object({ entryGroupId: z.string().min(1) })
export type PostingParam = z.infer<typeof PostingParam>

export const PostingLine = z.object({
  entryId: z.string(),
  accountId: z.string(),
  debitCents: z.number().int().nonnegative(),
  creditCents: z.number().int().nonnegative()
})
export type PostingLine = z.infer<typeof PostingLine>

export const Posting = z.object({
  entryGroupId: z.string(),
  kind: z.string(),
  occurredAt: z.string(),
  reversesGroupId: z.string().nullable(),
  source: LedgerSource,
  lines: z.array(PostingLine),
  totalDebitCents: z.number().int(),
  totalCreditCents: z.number().int(),
  balanced: z.boolean()
})
export type Posting = z.infer<typeof Posting>
