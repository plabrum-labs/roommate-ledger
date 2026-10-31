import { BadRequest, Conflict, NotFound } from '@/framework'
import * as domain from '@/domain/errors'

/** The one place domain errors become HTTP errors; anything else propagates unchanged. */
export function mapDomainError(error: unknown): Error {
  if (error instanceof domain.NotFound) return new NotFound(error.message)
  if (error instanceof domain.Conflict) return new Conflict(error.message)
  if (error instanceof domain.Invalid) return new BadRequest(error.message)
  return error instanceof Error ? error : new Error(String(error))
}
