import { z } from 'zod'

import { createParty } from '@/domain/services'
import { listParties } from '@/domain/queries'

import type { Ctx } from './context'
import { get, post } from './routes'
import { Party, PartyCreate } from './schemas'

export class PartyController {
  @get('/parties', { operationId: 'listParties', returns: z.array(Party), tags: ['parties'] })
  async list(ctx: Ctx): Promise<Party[]> {
    return listParties(ctx.db)
  }

  @post('/parties', { operationId: 'createParty', body: PartyCreate, returns: Party, status: 201, tags: ['parties'] })
  async create(ctx: Ctx, data: PartyCreate): Promise<Party> {
    return createParty(ctx.db, { ...data, id: data.id ?? crypto.randomUUID() })
  }
}
