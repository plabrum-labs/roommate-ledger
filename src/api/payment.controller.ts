import { z } from 'zod'

import { listPayments } from '@/domain/queries'
import { createPayment } from '@/domain/services'

import type { Ctx } from './context'
import { get, post } from './routes'
import { Payment, PaymentCreate, PaymentListQuery } from './schemas'

const tags = ['payments']

export class PaymentController {
  /** The client-supplied `id` is the idempotency key: replaying it returns the stored payment. */
  @post('/payments', { operationId: 'recordPayment', body: PaymentCreate, returns: Payment, status: 201, tags })
  async record(ctx: Ctx, data: PaymentCreate): Promise<Payment> {
    return createPayment(ctx.db, data, new Date().toISOString())
  }

  @get('/payments', { operationId: 'listPayments', params: PaymentListQuery, returns: z.array(Payment), tags })
  async list(ctx: Ctx, { partyId }: PaymentListQuery): Promise<Payment[]> {
    return listPayments(ctx.db, partyId)
  }
}
