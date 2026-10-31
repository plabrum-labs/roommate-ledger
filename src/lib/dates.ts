const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local calendar date as `YYYY-MM-DD`. */
export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function todayString(): string {
  return toDateString(new Date())
}

function parseDateString(date: string): { y: number; m: number; d: number } {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  return { y, m, d }
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parseDateString(date)
  return toDateString(new Date(y, m - 1, d + days))
}

/** Whole days from today to a `YYYY-MM-DD` date (negative when past). */
export function daysFromToday(date: string): number {
  const { y, m, d } = parseDateString(date)
  const now = new Date()
  const start = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((Date.UTC(y, m - 1, d) - start) / 86_400_000)
}

function label(y: number, m: number, d: number): string {
  const sameYear = y === new Date().getFullYear()
  return `${MONTHS[m - 1] ?? ''} ${d}${sameYear ? '' : `, ${y}`}`
}

/** `YYYY-MM-DD` as `Nov 14` (year added when not the current year). */
export function formatDate(date: string): string {
  const { y, m, d } = parseDateString(date)
  return label(y, m, d)
}

/** ISO timestamp as a local `Oct 26`. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return label(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

export function monthLabel(iso: string): string {
  const date = new Date(iso)
  return `${LONG_MONTHS[date.getMonth()] ?? ''} ${date.getFullYear()}`
}

/** Timestamp for a calendar date chosen in the UI: now if it is today, otherwise noon UTC that day. */
export function dateToTimestamp(date: string): string {
  return date === todayString() ? new Date().toISOString() : `${date}T12:00:00.000Z`
}

export function startOfDay(date: string): string {
  const { y, m, d } = parseDateString(date)
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString()
}

export function endOfDay(date: string): string {
  const { y, m, d } = parseDateString(date)
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString()
}
