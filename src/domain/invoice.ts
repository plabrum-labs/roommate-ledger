import { z } from 'zod'

export const InvoiceStatus = z.enum(['issued', 'requested', 'void'])
export type InvoiceStatus = z.infer<typeof InvoiceStatus>

export const Settlement = z.enum(['unpaid', 'partially_paid', 'paid'])
export type Settlement = z.infer<typeof Settlement>

export const LineItem = z.object({
  id: z.string().min(1),
  invoiceId: z.string().min(1),
  position: z.number().int().nonnegative(),
  description: z.string().min(1),
  category: z.string().min(1),
  amountCents: z.number().int().positive()
})
export type LineItem = z.infer<typeof LineItem>

/** What a caller supplies for a line; ids and position are assigned by the service. */
export const NewLineItem = LineItem.pick({ description: true, category: true, amountCents: true })
export type NewLineItem = z.infer<typeof NewLineItem>

export const Invoice = z.object({
  id: z.string().min(1),
  payerId: z.string().min(1),
  payeeId: z.string().min(1),
  /** Denormalised sum of the line items, kept equal by trigger. */
  amountCents: z.number().int().positive(),
  description: z.string(),
  issuedAt: z.iso.datetime(),
  dueDate: z.iso.date(),
  status: InvoiceStatus,
  settlement: Settlement,
  appliedCents: z.number().int().nonnegative()
})
export type Invoice = z.infer<typeof Invoice>

/** The document the ledger entries are declared over: an invoice together with its lines. */
export const InvoiceWithLines = Invoice.extend({ lineItems: z.array(LineItem) })
export type InvoiceWithLines = z.infer<typeof InvoiceWithLines>

/** What a caller supplies; the amount, lifecycle and cache fields are set by the service. */
export const NewInvoice = Invoice.omit({
  amountCents: true,
  status: true,
  settlement: true,
  appliedCents: true
}).extend({ lineItems: z.array(NewLineItem).min(1) })
export type NewInvoice = z.infer<typeof NewInvoice>

export const sumCents = (lines: readonly { amountCents: number }[]): number =>
  lines.reduce((sum, l) => sum + l.amountCents, 0)
