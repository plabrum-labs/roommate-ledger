import { os, type AnyProcedure, type Context } from '@orpc/server'
import { z } from 'zod'

import { routesOf, type RouteDefinition } from './decorators'

/** A flat router keyed by `operationId`. */
declare const contextBrand: unique symbol

export type ApiRouter<Ctx extends Context = Context> = Record<string, AnyProcedure> & {
  /** Phantom marker carrying the context type the procedures expect. */
  readonly [contextBrand]?: Ctx
}

type ObjectSchema = z.ZodObject

function pathKeys(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map(m => m[1] ?? '')
}

function mask(keys: string[]): Record<string, true> {
  return Object.fromEntries(keys.map(k => [k, true as const]))
}

/** Splits a params object into the path part and the query part. */
function splitParams(route: RouteDefinition, params: z.ZodType): { path?: ObjectSchema; query?: ObjectSchema } {
  if (!(params instanceof z.ZodObject)) {
    throw new Error(`${route.options.operationId}: \`params\` must be a z.object`)
  }
  const schema: ObjectSchema = params
  const inPath = pathKeys(route.path).filter(k => k in schema.shape)
  const rest = Object.keys(schema.shape).filter(k => !inPath.includes(k))
  return {
    path: inPath.length > 0 ? schema.pick(mask(inPath)) : undefined,
    query: rest.length > 0 ? schema.pick(mask(rest)) : undefined
  }
}

interface DetailedInput {
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  body?: unknown
}

/**
 * Builds an oRPC router from decorated controller instances. Uses oRPC's `detailed` input
 * structure: path params arrive as `input.params`, query string as `input.query`, JSON body as
 * `input.body`. The handler receives `(ctx, params?, body?)` where `params` merges path and query.
 */
export function toRouter<Ctx extends Context>(...controllers: object[]): ApiRouter<Ctx> {
  return toRouterWith<Ctx>({}, ...controllers)
}

export interface RouterOptions {
  /** Translates anything a handler throws (e.g. domain errors) into the error to surface. */
  mapError?: (error: unknown) => Error
}

export function toRouterWith<Ctx extends Context>(options: RouterOptions, ...controllers: object[]): ApiRouter<Ctx> {
  const base = os.$context<Ctx>()
  const router: Record<string, AnyProcedure> = {}

  for (const controller of controllers) {
    for (const route of routesOf(controller)) {
      const { operationId, tags, summary, description, status, params, body, returns } = route.options
      if (operationId in router) throw new Error(`Duplicate operationId: ${operationId}`)

      const split = params ? splitParams(route, params) : {}
      const shape: Record<string, z.ZodType> = {}
      if (split.path) shape.params = split.path
      if (split.query) shape.query = split.query
      if (body) shape.body = body

      const target = (controller as Record<string | symbol, unknown>)[route.property]
      if (typeof target !== 'function') {
        throw new Error(`${operationId}: ${String(route.property)} is not a method`)
      }

      const routed = base.route({
        method: route.method,
        path: route.path,
        operationId,
        tags,
        summary,
        description,
        successStatus: status,
        inputStructure: 'detailed'
      })
      const inputSchema = z.object(shape)
      router[operationId] = routed
        .input(inputSchema)
        .output(returns)
        .handler(async ({ context, input }) => {
          const { params: pathPart, query, body: bodyPart } = input as DetailedInput
          const args: unknown[] = []
          if (params) args.push({ ...pathPart, ...query })
          if (body) args.push(bodyPart)
          try {
            return (await target.call(controller, context, ...args)) as unknown
          } catch (error) {
            if (options.mapError) throw options.mapError(error)
            throw error
          }
        })
    }
  }
  return router
}
