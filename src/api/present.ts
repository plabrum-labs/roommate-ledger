import type { Invoice, InvoiceWithLines } from '@/domain/invoice'
import { allowedTransitions } from '@/domain/invoice-state'
import type {
  LineSource,
  PostingLine as DomainPostingLine,
  StatementLine as DomainStatementLine
} from '@/domain/queries'

import type { InvoiceDetail, InvoiceSummary, InvoiceTransition, LedgerSource, Posting, StatementLine } from './schemas'

/** A void invoice's cached settlement is stale (the trigger skips void rows), so it is not presented. */
export function presentInvoice(invoice: Invoice, lineCount: number): InvoiceSummary {
  const live = invoice.status !== 'void'
  const appliedCents = live ? invoice.appliedCents : 0
  return {
    ...invoice,
    settlement: live ? invoice.settlement : null,
    appliedCents,
    remainingCents: live ? invoice.amountCents - appliedCents : 0,
    lineCount
  }
}

export function presentInvoiceDetail(invoice: InvoiceWithLines, transitions: InvoiceTransition[]): InvoiceDetail {
  return {
    ...presentInvoice(invoice, invoice.lineItems.length),
    lineItems: invoice.lineItems,
    transitions,
    allowedTransitions: [...allowedTransitions(invoice)]
  }
}

export function presentSource(line: LineSource): LedgerSource {
  if (line.invoiceId !== null) {
    return {
      type: 'invoice',
      invoiceId: line.invoiceId,
      description: line.invoiceDescription ?? '',
      status: line.invoiceStatus ?? 'issued'
    }
  }
  return {
    type: 'payment',
    paymentId: line.paymentId ?? '',
    method: line.paymentMethod ?? 'cash',
    reference: line.paymentReference
  }
}

function describe(source: LedgerSource, reversal: boolean): string {
  const base = source.type === 'invoice' ? source.description : `Payment (${source.method})`
  return reversal ? `Void: ${base}` : base
}

/** Party perspective: payable accounts are credit-normal, so their ledger signs are flipped. */
export function presentStatementLine(line: DomainStatementLine, sign: 1 | -1): StatementLine {
  const source = presentSource(line)
  const reversal = line.reversesGroupId !== null
  return {
    entryId: line.entryId,
    entryGroupId: line.entryGroupId,
    occurredAt: line.occurredAt,
    description: describe(source, reversal),
    amountCents: sign * line.amountCents,
    balanceCents: sign * line.balanceCents,
    reversal,
    source
  }
}

export function presentPosting(
  entryGroupId: string,
  lines: readonly [DomainPostingLine, ...DomainPostingLine[]]
): Posting {
  const [first] = lines
  const totalDebitCents = lines.reduce((sum, l) => sum + Math.max(l.amountCents, 0), 0)
  const totalCreditCents = lines.reduce((sum, l) => sum + Math.max(-l.amountCents, 0), 0)
  return {
    entryGroupId,
    kind: first.kind,
    occurredAt: first.occurredAt,
    reversesGroupId: first.reversesGroupId,
    source: presentSource(first),
    lines: lines.map(l => ({
      entryId: l.entryId,
      accountId: l.accountId,
      debitCents: Math.max(l.amountCents, 0),
      creditCents: Math.max(-l.amountCents, 0)
    })),
    totalDebitCents,
    totalCreditCents,
    balanced: totalDebitCents === totalCreditCents
  }
}
