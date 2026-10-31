import { routes } from '@/framework'

import type { Ctx } from './context'

/** Decorators bound to this app's context: every handler's first parameter must be `Ctx`. */
export const { get, post, put, patch, del } = routes<Ctx>()
