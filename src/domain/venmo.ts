/** Cents as a `x.xx` decimal string without going through floats. */
export function formatDollars(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError('cents must be a non-negative integer')
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

/** Venmo "request" deep link (unofficial but working). Returns null when there is nothing to request. */
export function venmoRequestUrl(args: { handle: string | null; amountCents: number; note: string }): string | null {
  const handle = args.handle?.replace(/^@/, '').trim()
  if (!handle || args.amountCents <= 0) return null
  const query = [
    'txn=charge',
    'audience=private',
    `recipients=${encodeURIComponent(handle)}`,
    `amount=${formatDollars(args.amountCents)}`,
    `note=${encodeURIComponent(args.note)}`
  ].join('&')
  return `https://venmo.com/?${query}`
}
