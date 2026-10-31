import type { AccessConfig } from './config'
import { createAccessIdentifier, UnauthorizedError, type AccessIdentity } from './verify'

/**
 * Defence-in-depth check for `/api/*`: null lets the request through, otherwise the refusing response
 * (503 when unconfigured, 401 without a valid Access assertion). `identify` is injectable for tests.
 */
export async function guardApi(
  request: Request,
  config: AccessConfig,
  identify: ((req: Request) => Promise<AccessIdentity>) | null = config.kind === 'disabled'
    ? null
    : createAccessIdentifier(config)
): Promise<Response | null> {
  if (config.kind === 'disabled' || identify === null) {
    return Response.json({ error: 'Access not configured' }, { status: 503 })
  }
  try {
    await identify(request)
    return null
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    throw err
  }
}
