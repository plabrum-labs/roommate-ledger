import type { CSSProperties } from 'react'

import type { Settlement } from '@/api/schemas'
import { formatCents } from '@/lib/money'

const CLASS: Record<Settlement, string> = { unpaid: 'unpaid', partially_paid: 'partial', paid: 'paid' }

interface SettlementBadgeProps {
  settlement: Settlement | null
  appliedCents: number
  amountCents: number
}

export function SettlementBadge({ settlement, appliedCents, amountCents }: SettlementBadgeProps) {
  if (settlement === null) return <span className="muted">No settlement</span>
  const text =
    settlement === 'paid'
      ? '✓ Paid'
      : settlement === 'unpaid'
        ? 'Unpaid'
        : `◐ Part paid ${formatCents(appliedCents)} of ${formatCents(amountCents)}`
  return <span className={`pill ${CLASS[settlement]}`}>{text}</span>
}

/** Square progress bar of applied vs invoice amount. */
export function SettlementBar({ settlement, appliedCents, amountCents }: SettlementBadgeProps) {
  const percent =
    settlement === null || amountCents <= 0 ? 0 : Math.min(100, Math.floor((appliedCents * 100) / amountCents))
  return (
    <div
      className={`bar ${settlement === null ? 'unpaid' : CLASS[settlement]}`}
      role="img"
      aria-label={`${percent}% applied`}
    >
      <i style={{ '--p': `${percent}%` } as CSSProperties} />
    </div>
  )
}
