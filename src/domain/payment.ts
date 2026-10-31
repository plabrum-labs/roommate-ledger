import { z } from 'zod'

export const PaymentMethod = z.enum(['venmo', 'zelle', 'cash', 'provider_portal'])
export type PaymentMethod = z.infer<typeof PaymentMethod>

export const Payment = z.object({
  id: z.string().min(1),
  payerId: z.string().min(1),
  payeeId: z.string().min(1),
  amountCents: z.number().int().positive(),
  paidAt: z.iso.datetime(),
  method: PaymentMethod,
  reference: z.string().nullable()
})
export type Payment = z.infer<typeof Payment>
