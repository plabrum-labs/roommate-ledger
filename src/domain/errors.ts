/** Maps to HTTP 409. */
export class Conflict extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Conflict'
  }
}

/** Maps to HTTP 404. */
export class NotFound extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFound'
  }
}

/** Maps to HTTP 400: well-formed input that breaks a domain rule. */
export class Invalid extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Invalid'
  }
}
