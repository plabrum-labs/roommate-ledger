import type { z } from 'zod'

/**
 * Standard (TC39 / TS 5) method decorators that declare HTTP endpoints. The decorator's type
 * constrains the decorated method so its positional arguments and return type must match the
 * declared zod schemas:
 *
 *   (ctx)                  no params, no body
 *   (ctx, params)          `params` only
 *   (ctx, body)            `body` only
 *   (ctx, params, body)    both
 */

// Standard decorators store per-class data on `context.metadata`, which needs `Symbol.metadata`.
// Older runtimes lack it, so define it before any decorated class is evaluated.
if (!Reflect.has(Symbol, 'metadata')) {
  Object.defineProperty(Symbol, 'metadata', { value: Symbol.for('Symbol.metadata') })
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type ApiPath = `/${string}`
type Schema = z.ZodType
type MaybePromise<T> = T | Promise<T>

/** Positional handler arguments after `ctx`, derived from which schemas are declared. */
export type HandlerArgs<P extends Schema | undefined, B extends Schema | undefined> = [P] extends [Schema]
  ? [B] extends [Schema]
    ? [params: z.output<P>, body: z.output<B>]
    : [params: z.output<P>]
  : [B] extends [Schema]
    ? [body: z.output<B>]
    : []

interface RouteOptionsBase<R extends Schema> {
  /** Unique name; used by Orval for generated hook names. */
  operationId: string
  /** Response schema. The handler's return value is validated against it. */
  returns: R
  tags?: string[]
  summary?: string
  description?: string
  /** Success status code; defaults to 200. */
  status?: number
}

/**
 * Routes without a request body (GET, DELETE). `params` is a `z.object`; keys named in the path
 * template (`{id}`) are path parameters, the remaining keys are query parameters.
 */
export interface BodylessRouteOptions<P extends Schema | undefined, R extends Schema> extends RouteOptionsBase<R> {
  params?: P
}

/** Routes with an optional JSON body (POST, PUT, PATCH). */
export interface BodyRouteOptions<
  P extends Schema | undefined,
  B extends Schema | undefined,
  R extends Schema
> extends BodylessRouteOptions<P, R> {
  body?: B
}

export interface RouteDefinition {
  /** Method name on the controller instance. */
  property: string | symbol
  method: HttpMethod
  path: ApiPath
  options: BodyRouteOptions<Schema | undefined, Schema | undefined, Schema>
}

export const ROUTES: unique symbol = Symbol('framework.routes')

/** Reads the routes recorded on a controller's class metadata. */
export function routesOf(controller: object): readonly RouteDefinition[] {
  const metadata = (controller.constructor as { [Symbol.metadata]?: DecoratorMetadataObject | null })[Symbol.metadata]
  return (metadata?.[ROUTES] as RouteDefinition[] | undefined) ?? []
}

type Handler<P extends Schema | undefined, B extends Schema | undefined, R extends Schema, C> = (
  ctx: C,
  ...args: HandlerArgs<P, B>
) => MaybePromise<z.input<R>>

/** Rejects methods declaring fewer positional parameters than the route supplies. */
type ExactArity<
  T extends (...args: never) => unknown,
  P extends Schema | undefined,
  B extends Schema | undefined
> = Parameters<T>['length'] extends [unknown, ...HandlerArgs<P, B>]['length'] ? unknown : never

type MethodDecorator<P extends Schema | undefined, B extends Schema | undefined, R extends Schema, C> = <
  T extends Handler<P, B, R, C>
>(
  target: T & ExactArity<T, P, B>,
  context: ClassMethodDecoratorContext
) => void

function record(
  method: HttpMethod,
  path: ApiPath,
  options: BodyRouteOptions<Schema | undefined, Schema | undefined, Schema>,
  context: ClassMethodDecoratorContext
): void {
  const own = Object.hasOwn(context.metadata, ROUTES)
  const routes = (own ? context.metadata[ROUTES] : []) as RouteDefinition[]
  routes.push({ property: context.name, method, path, options })
  context.metadata[ROUTES] = routes
}

function bodyless<C>(method: 'GET' | 'DELETE') {
  return <P extends Schema | undefined = undefined, R extends Schema = Schema>(
      path: ApiPath,
      options: BodylessRouteOptions<P, R>
    ): MethodDecorator<P, undefined, R, C> =>
    (_target, context) => {
      record(method, path, options, context)
    }
}

function withBody<C>(method: 'POST' | 'PUT' | 'PATCH') {
  return <
      P extends Schema | undefined = undefined,
      B extends Schema | undefined = undefined,
      R extends Schema = Schema
    >(
      path: ApiPath,
      options: BodyRouteOptions<P, B, R>
    ): MethodDecorator<P, B, R, C> =>
    (_target, context) => {
      record(method, path, options, context)
    }
}

/**
 * Decorator set whose handlers must take `C` as their first (ctx) parameter. Use one
 * `export const { get, post, ... } = routes<AppCtx>()` per app so a controller method with a
 * mismatching ctx type fails to compile.
 */
export function routes<C>() {
  return {
    get: bodyless<C>('GET'),
    del: bodyless<C>('DELETE'),
    post: withBody<C>('POST'),
    put: withBody<C>('PUT'),
    patch: withBody<C>('PATCH')
  }
}

/** Untyped-ctx decorators (any ctx accepted); prefer `routes<Ctx>()` in apps. */
export const { get, del, post, put, patch } = routes<never>()
