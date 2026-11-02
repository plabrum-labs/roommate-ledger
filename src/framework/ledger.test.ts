import { describe, expect, it } from 'vitest'

import { chunkByParameters, MAX_BOUND_PARAMETERS } from './ledger'

describe('chunkByParameters', () => {
  it('fills each statement up to the D1 limit, counting the fixed per-statement parameters', () => {
    const rows = Array.from({ length: 25 }, (_, i) => i)
    const chunks = chunkByParameters(rows, () => 9, 2)
    expect(chunks.flat()).toEqual(rows)
    for (const chunk of chunks) expect(chunk.length * 9 + 2).toBeLessThanOrEqual(MAX_BOUND_PARAMETERS)
    expect(chunks.map(c => c.length)).toEqual([10, 10, 5])
  })

  it('returns nothing for no rows and rejects a row that can never fit', () => {
    expect(chunkByParameters([], () => 9)).toEqual([])
    expect(() => chunkByParameters([1], () => 99, 2)).toThrow(RangeError)
  })
})
