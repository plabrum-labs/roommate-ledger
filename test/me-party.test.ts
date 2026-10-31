import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'

import { createDb } from '@/db/client'
import { listParties } from '@/domain/queries'
import { ME } from '@/ledger'

// No freshDb() here: this is the database exactly as the migrations leave it (what a new deploy starts from).
it('a freshly migrated database already has the me party and nothing else', async () => {
  expect(await listParties(createDb(env.DB))).toEqual([{ id: ME, name: 'Me', kind: 'me', venmoHandle: null }])
})
