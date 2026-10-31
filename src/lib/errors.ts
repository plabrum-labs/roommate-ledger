import { ApiError } from '@/api-client/fetcher'

/** The API's error message (oRPC body `message`), or a generic fallback. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong'
}
