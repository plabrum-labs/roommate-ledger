import type { Db } from '@/db/client'

/** Per-request context handed to every controller method. */
export interface Ctx {
  db: Db
  /** Party id of the signed-in user ("me"). */
  me: string
}
