import { describe, expect, it } from 'vitest'

import { formatDollars, venmoRequestUrl } from './venmo'

describe('venmo', () => {
  it('formats cents exactly', () => {
    expect(formatDollars(0)).toBe('0.00')
    expect(formatDollars(5)).toBe('0.05')
    expect(formatDollars(12345)).toBe('123.45')
    expect(() => formatDollars(1.5)).toThrow(RangeError)
  })

  it('builds the charge deep link', () => {
    expect(venmoRequestUrl({ handle: '@sam-v', amountCents: 4250, note: 'Utilities & internet' })).toBe(
      'https://venmo.com/?txn=charge&audience=private&recipients=sam-v&amount=42.50&note=Utilities%20%26%20internet'
    )
  })

  it('returns null with no handle or nothing owed', () => {
    expect(venmoRequestUrl({ handle: null, amountCents: 100, note: 'x' })).toBeNull()
    expect(venmoRequestUrl({ handle: 'sam', amountCents: 0, note: 'x' })).toBeNull()
    expect(venmoRequestUrl({ handle: 'sam', amountCents: -5, note: 'x' })).toBeNull()
  })
})
