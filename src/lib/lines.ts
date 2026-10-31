import { centsToInput, parseDollarsToCents } from './money'

/** One editable invoice line: the amount stays a dollar string until it is parsed at the edge. */
export interface LineDraft {
  key: string
  description: string
  category: string
  amountText: string
  manual: boolean
}

export interface LineItemInput {
  description: string
  category: string
  amountCents: number
}

export const DEFAULT_CATEGORIES: readonly string[] = ['utilities', 'internet', 'water', 'groceries', 'other']

export function newKey(): string {
  return crypto.randomUUID()
}

export function lineFromCents(line: LineItemInput, manual = false): LineDraft {
  return {
    key: newKey(),
    description: line.description,
    category: line.category,
    amountText: centsToInput(line.amountCents),
    manual
  }
}

export function blankLine(category = 'other'): LineDraft {
  return { key: newKey(), description: '', category, amountText: '', manual: true }
}

export function lineCents(line: LineDraft): number | null {
  const cents = parseDollarsToCents(line.amountText)
  return cents !== null && cents > 0 ? cents : null
}

export function lineIsValid(line: LineDraft): boolean {
  return line.description.trim() !== '' && lineCents(line) !== null
}

/** Sum of the lines whose amount parses (invalid lines count as zero). */
export function totalCents(lines: readonly LineDraft[]): number {
  return lines.reduce((sum, line) => sum + (lineCents(line) ?? 0), 0)
}

/** API line items, or null when there are none or any line is incomplete. */
export function toLineItems(lines: readonly LineDraft[]): LineItemInput[] | null {
  if (lines.length === 0 || !lines.every(lineIsValid)) return null
  return lines.map(line => ({
    description: line.description.trim(),
    category: line.category,
    amountCents: lineCents(line) ?? 0
  }))
}
