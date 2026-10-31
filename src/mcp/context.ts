import type { AccessIdentity } from '@/access/verify'
import type { Ctx } from '@/api/context'

/** What every tool closes over: the API context (db + "me") and who Access says is calling. */
export interface McpToolContext {
  ctx: Ctx
  identity: AccessIdentity
}
