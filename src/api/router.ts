import { createApiHandler, generateOpenAPI, toRouterWith } from '@/framework'

import type { Ctx } from './context'
import { mapDomainError } from './errors'
import { InvoiceController } from './invoice.controller'
import { LedgerController } from './ledger.controller'
import { PartyController } from './party.controller'
import { PaymentController } from './payment.controller'

export const router = toRouterWith<Ctx>(
  { mapError: mapDomainError },
  new PartyController(),
  new InvoiceController(),
  new PaymentController(),
  new LedgerController()
)

export const handleApi = createApiHandler<Ctx>(router, { prefix: '/api' })

/** Stable, pretty-printed OpenAPI document (the committed `openapi.json`). */
export async function openApiText(): Promise<string> {
  const doc = await generateOpenAPI(
    router,
    { title: 'Roommate Ledger', version: '1.0.0' },
    { servers: [{ url: '/api' }] }
  )
  return `${JSON.stringify(doc, null, 2)}\n`
}
