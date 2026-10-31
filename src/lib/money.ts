const MINUS = '−'

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Integer cents as `$1,234.56`, `−$12.40` when negative, with an explicit `+` for positives when `signed`. No float math. */
export function formatCents(cents: number, options: { signed?: boolean } = {}): string {
  const abs = Math.abs(cents)
  const whole = groupThousands(String(Math.trunc(abs / 100)))
  const fraction = String(abs % 100).padStart(2, '0')
  const sign = cents < 0 ? MINUS : options.signed === true && cents > 0 ? '+' : ''
  return `${sign}$${whole}.${fraction}`
}

/** Integer cents as a plain `x.xx` string for editable inputs (no currency symbol or grouping). */
export function centsToInput(cents: number): string {
  const abs = Math.abs(cents)
  return `${cents < 0 ? '-' : ''}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

const DOLLARS = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{0,2}))?$/

/**
 * Parses a dollar string such as `18`, `18.5`, `$1,018.50` into integer cents by splitting the digits,
 * never going through floats. Returns null for anything that is not a non-negative amount with at most two decimals.
 */
export function parseDollarsToCents(text: string): number | null {
  const match = DOLLARS.exec(text.trim())
  if (!match) return null
  const [, wholeRaw, fractionRaw] = match
  if (wholeRaw === undefined && !fractionRaw) return null
  const whole = Number((wholeRaw ?? '0').replaceAll(',', ''))
  const fraction = Number((fractionRaw ?? '').padEnd(2, '0'))
  const cents = whole * 100 + fraction
  return Number.isSafeInteger(cents) ? cents : null
}
