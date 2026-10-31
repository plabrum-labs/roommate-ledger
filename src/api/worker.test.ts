import { exports } from 'cloudflare:workers'
import { beforeEach, expect, it } from 'vitest'

import { freshDb } from '@/testing/helpers'

// `exports.default` is the Worker's default export (worker.ts), invoked with the real bindings.
const fetchWorker = (path: string): Promise<Response> => exports.default.fetch(`http://x${path}`)

beforeEach(async () => {
  await freshDb()
})

it('serves the API under /api with the real D1', async () => {
  const res = await fetchWorker('/api/balances')
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ roommates: [{ partyId: 'alex' }, { partyId: 'sam' }] })
})

it('keeps /api/health and returns JSON 404 for unknown API paths', async () => {
  expect(await (await fetchWorker('/api/health')).json()).toEqual({ ok: true })
  const res = await fetchWorker('/api/nothing')
  expect(res.status).toBe(404)
  expect(await res.json()).toMatchObject({ code: 'NOT_FOUND' })
})
