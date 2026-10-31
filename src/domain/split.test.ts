import { expect, it } from 'vitest'

import { splitEqual } from './split'

it('splits with largest remainder and sums exactly', () => {
  expect(splitEqual(10000, 3)).toEqual([3334, 3333, 3333])
  expect(splitEqual(100, 3).reduce((a, b) => a + b, 0)).toBe(100)
  expect(splitEqual(5, 1)).toEqual([5])
  expect(splitEqual(2, 3)).toEqual([1, 1, 0])
})
