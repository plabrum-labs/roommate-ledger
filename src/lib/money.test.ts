import { describe, expect, it } from 'vitest'

import { centsToInput, formatCents, parseDollarsToCents } from './money'

describe('formatCents', () => {
  it('formats integer cents', () => {
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(5)).toBe('$0.05')
    expect(formatCents(13347)).toBe('$133.47')
    expect(formatCents(123456789)).toBe('$1,234,567.89')
  })
  it('shows a real minus and optional plus', () => {
    expect(formatCents(-1240)).toBe('−$12.40')
    expect(formatCents(3347, { signed: true })).toBe('+$33.47')
    expect(formatCents(0, { signed: true })).toBe('$0.00')
  })
})

describe('parseDollarsToCents', () => {
  it('parses exactly', () => {
    expect(parseDollarsToCents('18')).toBe(1800)
    expect(parseDollarsToCents('18.5')).toBe(1850)
    expect(parseDollarsToCents('0.07')).toBe(7)
    expect(parseDollarsToCents('$1,018.50')).toBe(101850)
    expect(parseDollarsToCents('.5')).toBe(50)
    expect(parseDollarsToCents('19.99')).toBe(1999)
    expect(parseDollarsToCents('1.15')).toBe(115)
  })
  it('rejects junk', () => {
    expect(parseDollarsToCents('')).toBeNull()
    expect(parseDollarsToCents('.')).toBeNull()
    expect(parseDollarsToCents('1.234')).toBeNull()
    expect(parseDollarsToCents('-3')).toBeNull()
    expect(parseDollarsToCents('abc')).toBeNull()
  })
  it('round-trips with centsToInput', () => {
    expect(centsToInput(3555)).toBe('35.55')
    expect(parseDollarsToCents(centsToInput(1))).toBe(1)
  })
})
