// Mirrors soren-em-wedding src/server/mcp/handler.ts; extract on third use.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import type { AccessConfig } from '@/access/config'
import { createAccessIdentifier, UnauthorizedError, type AccessIdentity } from '@/access/verify'
import type { Ctx } from '@/api/context'

import { buildMcpServer } from './server'

/** Stateless Streamable HTTP: a fresh server + transport per request (all state lives in D1). */
export async function handleMcpRequest(request: Request, ctx: Ctx, identity: AccessIdentity): Promise<Response> {
  const server = buildMcpServer({ ctx, identity })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  })
  await server.connect(transport)
  return transport.handleRequest(request)
}

/**
 * The `/mcp` route, given the configured auth. Access has already authenticated the caller at the edge
 * (Managed OAuth); this re-verifies the signed assertion against the MCP app's AUD. `identify` is injectable
 * so tests can verify against a local key set.
 */
export async function handleMcpRoute(
  request: Request,
  ctx: Ctx,
  config: AccessConfig,
  identify: ((req: Request) => Promise<AccessIdentity>) | null = config.kind === 'disabled'
    ? null
    : createAccessIdentifier(config)
): Promise<Response> {
  if (config.kind === 'disabled' || identify === null) {
    return Response.json({ error: 'MCP not configured' }, { status: 503 })
  }
  let identity: AccessIdentity
  try {
    identity = await identify(request)
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    throw err
  }
  return handleMcpRequest(request, ctx, identity)
}
