import { ORPCError } from '@orpc/server'

/** 404 — the addressed resource does not exist. */
export class NotFound extends ORPCError<'NOT_FOUND', unknown> {
  constructor(message = 'Not found', data?: unknown) {
    super('NOT_FOUND', { message, data })
  }
}

/** 409 — the request conflicts with current state (duplicate, already voided, ...). */
export class Conflict extends ORPCError<'CONFLICT', unknown> {
  constructor(message = 'Conflict', data?: unknown) {
    super('CONFLICT', { message, data })
  }
}

/** 400 — the request is well-formed but semantically invalid. */
export class BadRequest extends ORPCError<'BAD_REQUEST', unknown> {
  constructor(message = 'Bad request', data?: unknown) {
    super('BAD_REQUEST', { message, data })
  }
}
