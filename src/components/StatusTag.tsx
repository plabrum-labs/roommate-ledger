import type { InvoiceStatus } from '@/api/schemas'

const LABELS: Record<InvoiceStatus, string> = { issued: 'Issued', requested: 'Requested', void: 'Void' }

export function StatusTag({ status }: { status: InvoiceStatus }) {
  return <span className={`tag ${status}`}>{LABELS[status]}</span>
}
