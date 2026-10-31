import { formatCents } from '@/lib/money'

interface MoneyProps {
  cents: number
  /** Show an explicit `+` / `−` (statement rows). */
  signed?: boolean
  /** Prefix a CREDIT tag when the amount is negative (a balance the other side is owed). */
  credit?: boolean
  className?: string
}

export function Money({ cents, signed = false, credit = false, className }: MoneyProps) {
  return (
    <span className={`fig ${className ?? ''}`.trim()}>
      {credit && cents < 0 && <span className="sign">CREDIT</span>}
      {formatCents(cents, { signed })}
    </span>
  )
}
