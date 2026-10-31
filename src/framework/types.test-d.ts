import { z } from 'zod'

import { get, post, routes } from './index'

const Vessel = z.object({ id: z.string(), name: z.string() })
type Vessel = z.infer<typeof Vessel>
const Create = z.object({ name: z.string() })
type Create = z.infer<typeof Create>
const IdParam = z.object({ id: z.string() })
type IdParam = z.infer<typeof IdParam>
interface Ctx {
  user: string
}

export class Good {
  @post('/a/{id}', { operationId: 'a', params: IdParam, body: Create, returns: Vessel })
  a(_ctx: Ctx, _p: IdParam, _d: Create): Vessel {
    return { id: '1', name: 'x' }
  }
}

export class Bad {
  // must fail: body parameter type does not match the declared schema
  // @ts-expect-error wrong body type
  @post('/b', { operationId: 'b', body: Create, returns: Vessel })
  b(_ctx: Ctx, _d: { nope: number }): Vessel {
    return { id: '1', name: 'x' }
  }

  // must fail: return type does not match the declared schema
  // @ts-expect-error wrong return type
  @get('/c', { operationId: 'c', returns: Vessel })
  c(_ctx: Ctx): { id: number } {
    return { id: 1 }
  }

  // must fail: params declared but the method does not accept them
  // @ts-expect-error missing params argument
  @get('/d/{id}', { operationId: 'd', params: IdParam, returns: Vessel })
  d(_ctx: Ctx): Vessel {
    return { id: '1', name: 'x' }
  }
}

interface AppCtx {
  db: string
  me: string
}
const typed = routes<AppCtx>()

export class TypedCtx {
  @typed.get('/ok', { operationId: 'ok', returns: Vessel })
  ok(_ctx: AppCtx): Vessel {
    return { id: '1', name: 'x' }
  }

  // must fail: ctx parameter type differs from the app's ctx
  // @ts-expect-error wrong ctx type
  @typed.get('/wrong', { operationId: 'wrong', returns: Vessel })
  wrong(_ctx: { user: string }): Vessel {
    return { id: '1', name: 'x' }
  }
}
