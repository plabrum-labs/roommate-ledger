/** Equal split of cents using largest remainder: parts sum exactly to `totalCents`; earlier parts get the extra cents. */
export function splitEqual(totalCents: number, ways: number): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0)
    throw new RangeError('totalCents must be a non-negative integer')
  if (!Number.isInteger(ways) || ways < 1) throw new RangeError('ways must be a positive integer')
  const base = Math.floor(totalCents / ways)
  const extra = totalCents - base * ways
  return Array.from({ length: ways }, (_, i) => base + (i < extra ? 1 : 0))
}

export interface SplitLine {
  description: string
  category: string
  amountCents: number
}

export interface SplitBill {
  description: string
  lineItems: readonly SplitLine[]
}

/**
 * Splits every line of every bill equally across `roommateCount` roommates and me (the last party).
 * Each line is split with largest remainder, so each line's shares sum exactly to the line. The extra
 * cents rotate across the lines of a bill (starting with the first roommate for each bill), so a
 * bill's per-party totals equal its own largest-remainder split. Zero-cent shares are dropped.
 * Returns each roommate's share lines, in bill order, and my share in cents.
 */
export function splitBills(
  bills: readonly SplitBill[],
  roommateCount: number
): { roommateLines: SplitLine[][]; myShareCents: number } {
  const ways = roommateCount + 1
  const roommateLines: SplitLine[][] = Array.from({ length: roommateCount }, () => [])
  let myShareCents = 0
  for (const bill of bills) {
    let offset = 0
    for (const line of bill.lineItems) {
      const parts = splitEqual(line.amountCents, ways)
      const shareOf = (party: number): number => parts[(party - offset + ways) % ways] ?? 0
      const description =
        bill.lineItems.length === 1 ? `${bill.description} share` : `${bill.description} share (${line.description})`
      roommateLines.forEach((lines, party) => {
        const amountCents = shareOf(party)
        if (amountCents > 0) lines.push({ description, category: line.category, amountCents })
      })
      myShareCents += shareOf(roommateCount)
      offset = (offset + (line.amountCents % ways)) % ways
    }
  }
  return { roommateLines, myShareCents }
}
