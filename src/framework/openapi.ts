import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'

import type { Context } from '@orpc/server'

import type { ApiRouter } from './router'

export interface OpenAPIInfo {
  title: string
  version: string
  description?: string
}

/** Generates the OpenAPI 3.1 document for a router. */
export async function generateOpenAPI(
  router: ApiRouter,
  info: OpenAPIInfo,
  options: { servers?: { url: string }[] } = {}
): Promise<Record<string, unknown>> {
  const generator = new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] })
  return generator.generate(router, { info, servers: options.servers })
}

export interface ApiHandlerOptions {
  /** URL prefix the API is mounted under, e.g. `/api`. */
  prefix?: `/${string}`
}

/**
 * Wraps the router in a fetch handler. Returns `undefined` when no route matches so the caller can
 * fall through to other handlers (static assets, SPA).
 */
export function createApiHandler<Ctx extends Context>(
  router: ApiRouter<Ctx>,
  options: ApiHandlerOptions = {}
): (request: Request, context: Ctx) => Promise<Response | undefined> {
  const handler = new OpenAPIHandler<Ctx>(router)
  return async (request, context) => {
    const result = await handler.handle(request, { prefix: options.prefix, context })
    return result.matched ? result.response : undefined
  }
}
