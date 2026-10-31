import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  BadRequest,
  Conflict,
  NotFound,
  createApiHandler,
  del,
  generateOpenAPI,
  get,
  patch,
  post,
  toRouter
} from './index'

interface Ctx {
  store: Map<string, Vessel>
}

const Vessel = z.object({ id: z.string(), name: z.string() })
type Vessel = z.infer<typeof Vessel>
const VesselCreate = z.object({ name: z.string().min(1) })
type VesselCreate = z.infer<typeof VesselCreate>
const IdParam = z.object({ id: z.string() })
type IdParam = z.infer<typeof IdParam>
const ListQuery = z.object({ prefix: z.string().optional() })
type ListQuery = z.infer<typeof ListQuery>

class VesselController {
  @get('/vessels', { operationId: 'listVessels', params: ListQuery, returns: z.array(Vessel), tags: ['vessels'] })
  list(ctx: Ctx, { prefix }: ListQuery): Vessel[] {
    return [...ctx.store.values()].filter(v => v.name.startsWith(prefix ?? ''))
  }

  @get('/vessels/{id}', { operationId: 'getVessel', params: IdParam, returns: Vessel })
  get(ctx: Ctx, { id }: IdParam): Vessel {
    const v = ctx.store.get(id)
    if (!v) throw new NotFound(`vessel ${id}`)
    return v
  }

  @post('/vessels', { operationId: 'createVessel', body: VesselCreate, returns: Vessel, status: 201 })
  async create(ctx: Ctx, data: VesselCreate): Promise<Vessel> {
    if ([...ctx.store.values()].some(v => v.name === data.name)) throw new Conflict('duplicate')
    const v = { id: String(ctx.store.size + 1), name: data.name }
    ctx.store.set(v.id, v)
    return Promise.resolve(v)
  }

  @post('/vessels/{id}/rename', { operationId: 'renameVessel', params: IdParam, body: VesselCreate, returns: Vessel })
  rename(ctx: Ctx, { id }: IdParam, data: VesselCreate): Vessel {
    const v = ctx.store.get(id)
    if (!v) throw new NotFound()
    const next = { ...v, name: data.name }
    ctx.store.set(id, next)
    return next
  }

  @patch('/vessels/{id}/broken', { operationId: 'brokenVessel', params: IdParam, returns: Vessel })
  broken(_ctx: Ctx, _p: IdParam): Vessel {
    // @ts-expect-error deliberately violates the output schema at runtime
    return { id: 1 }
  }

  @del('/vessels/{id}', { operationId: 'deleteVessel', params: IdParam, returns: z.object({ ok: z.boolean() }) })
  remove(ctx: Ctx, { id }: IdParam): { ok: boolean } {
    if (!ctx.store.delete(id)) throw new BadRequest('nothing to delete')
    return { ok: true }
  }
}

const router = toRouter<Ctx>(new VesselController())
const handle = createApiHandler<Ctx>(router, { prefix: '/api' })

async function call(ctx: Ctx, method: string, path: string, body?: unknown): Promise<Response> {
  const res = await handle(
    new Request(`http://x/api${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }),
    ctx
  )
  if (!res) throw new Error('unmatched')
  return res
}

const fresh = (): Ctx => ({ store: new Map([['a', { id: 'a', name: 'Alpha' }]]) })

describe('endpoints', () => {
  it('lists with GET query params', async () => {
    const ctx = fresh()
    ctx.store.set('b', { id: 'b', name: 'Beta' })
    const res = await call(ctx, 'GET', '/vessels?prefix=Be')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 'b', name: 'Beta' }])
  })

  it('reads path params', async () => {
    const res = await call(fresh(), 'GET', '/vessels/a')
    expect(await res.json()).toEqual({ id: 'a', name: 'Alpha' })
  })

  it('creates with 201', async () => {
    const res = await call(fresh(), 'POST', '/vessels', { name: 'Gamma' })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ name: 'Gamma' })
  })

  it('combines path params and body', async () => {
    const ctx = fresh()
    const res = await call(ctx, 'POST', '/vessels/a/rename', { name: 'Omega' })
    expect(await res.json()).toEqual({ id: 'a', name: 'Omega' })
  })

  it('400 on invalid body', async () => {
    expect((await call(fresh(), 'POST', '/vessels', { name: '' })).status).toBe(400)
  })

  it('maps typed errors', async () => {
    expect((await call(fresh(), 'GET', '/vessels/zzz')).status).toBe(404)
    expect((await call(fresh(), 'POST', '/vessels', { name: 'Alpha' })).status).toBe(409)
    expect((await call(fresh(), 'DELETE', '/vessels/zzz')).status).toBe(400)
    expect((await call(fresh(), 'DELETE', '/vessels/a')).status).toBe(200)
  })

  it('validates output', async () => {
    expect((await call(fresh(), 'PATCH', '/vessels/a/broken')).status).toBe(500)
  })

  it('returns undefined for unmatched paths', async () => {
    const res = await handle(new Request('http://x/other'), fresh())
    expect(res).toBeUndefined()
  })
})

describe('openapi', () => {
  it('documents operations', async () => {
    const doc = (await generateOpenAPI(router, { title: 't', version: '1' })) as {
      paths: Record<
        string,
        Record<
          string,
          {
            operationId: string
            parameters?: { name: string; in: string }[]
            responses: Record<string, { content?: unknown }>
          }
        >
      >
    }
    expect(doc.paths['/vessels']?.get?.operationId).toBe('listVessels')
    expect(doc.paths['/vessels']?.get?.parameters).toContainEqual(
      expect.objectContaining({ name: 'prefix', in: 'query' })
    )
    expect(doc.paths['/vessels']?.post?.responses['201']?.content).toBeDefined()
    const getOne = doc.paths['/vessels/{id}']?.get
    expect(getOne?.parameters).toContainEqual(expect.objectContaining({ name: 'id', in: 'path' }))
    expect(getOne?.responses['200']?.content).toBeDefined()
    expect(doc.paths['/vessels/{id}']?.delete?.operationId).toBe('deleteVessel')
    expect(doc.paths['/vessels/{id}/rename']?.post?.operationId).toBe('renameVessel')
  })
})
