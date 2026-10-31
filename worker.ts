import { createDb } from '@/db/client'
import { handleApi } from '@/api/router'
import { ME } from '@/ledger'

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/health') return Response.json({ ok: true })
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const response = await handleApi(request, { db: createDb(env.DB), me: ME })
      return response ?? Response.json({ code: 'NOT_FOUND', status: 404, message: 'Not found' }, { status: 404 })
    }
    return env.ASSETS.fetch(request)
  }
} satisfies ExportedHandler<Env>
