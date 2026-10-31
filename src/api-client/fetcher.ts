/** Orval mutator: prefixes `/api`, parses JSON, and throws `ApiError` on non-2xx. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Parsed JSON error body (oRPC shape: `{ code, status, message, data }`), or the raw text. */
    readonly body: unknown
  ) {
    super(typeof body === 'object' && body !== null && 'message' in body ? String(body.message) : `HTTP ${status}`)
    this.name = 'ApiError'
  }
}

const BASE = '/api'
const NO_BODY = new Set([204, 205, 304])

function parse(text: string): unknown {
  if (text === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

export async function customFetch<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${url}`, options)
  const data = NO_BODY.has(response.status) ? undefined : parse(await response.text())
  if (!response.ok) throw new ApiError(response.status, data)
  // Orval types each response as `{ data, status, headers }`; T is that generated union, which cannot be derived here.
  return { data, status: response.status, headers: response.headers } as T
}

export type ErrorType<E = unknown> = ApiError | E
