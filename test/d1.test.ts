import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'

it('has a working local D1', async () => {
  const row = await env.DB.prepare('SELECT 1 AS one').first<{ one: number }>()
  expect(row?.one).toBe(1)
})
