import { z } from 'zod'

export const Party = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['me', 'roommate', 'provider']),
  venmoHandle: z.string().nullable()
})
export type Party = z.infer<typeof Party>
