import { apiAccessConfig, mcpAccessConfig } from '@/access/config'
import { guardApi } from '@/access/guard'
import { handleApi } from '@/api/router'
import { createDb } from '@/db/client'
import { ME } from '@/ledger'
import { routeRequest } from '@/lib/host-routing'
import { handleMcpRoute } from '@/mcp/handler'

const notFound = (): Response =>
  Response.json({ code: 'NOT_FOUND', status: 404, message: 'Not found' }, { status: 404 })

/** `import.meta.env.PROD` is true in the built Worker and false under `vite dev` and vitest. */
const PRODUCTION = import.meta.env.PROD

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    const route = routeRequest(request.headers.get('host') ?? url.host, url.pathname)
    switch (route.kind) {
      case 'not-found':
        return notFound()
      case 'mcp': {
        // Managed OAuth's /.well-known/oauth-* is answered by Access at the edge; only /mcp reaches this Worker.
        const config = mcpAccessConfig(env, PRODUCTION)
        return handleMcpRoute(request, { db: createDb(env.DB), me: ME }, config)
      }
      case 'api': {
        // Defence in depth: Access already guards this hostname at the edge.
        const refused = await guardApi(request, apiAccessConfig(env, PRODUCTION))
        if (refused) return refused
        if (url.pathname === '/api/health') return Response.json({ ok: true })
        const response = await handleApi(request, { db: createDb(env.DB), me: ME })
        return response ?? notFound()
      }
      case 'assets':
        return env.ASSETS.fetch(request)
    }
  }
} satisfies ExportedHandler<Env>
