// Mirrors soren-em-wedding src/server/mcp/tools/util.ts; extract on third use.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ORPCError } from '@orpc/server'
import { z } from 'zod'

import { Conflict, Invalid, NotFound } from '@/domain/errors'

/** Success: a one-line summary, then the data as compact JSON; `data` is also returned as `structuredContent`. */
export function jsonResult(summary: string, data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: `${summary}\n${JSON.stringify(data)}` }],
    structuredContent: data
  }
}

export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

/** Money in every schema is positive integer cents; this keeps the description uniform. */
export const cents = (what: string): z.ZodNumber =>
  z.number().int().positive().describe(`${what}, in integer cents (e.g. $12.34 is 1234)`)

/** Wraps a tool body: known domain/API errors become friendly isError results; anything else a generic isError. */
export async function withToolErrors(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof NotFound) return toolError(`Not found: ${err.message}`)
    if (err instanceof Conflict) return toolError(`Couldn't do that: ${err.message}`)
    if (err instanceof Invalid) return toolError(`That isn't valid: ${err.message}`)
    if (err instanceof ORPCError) return toolError(err.message)
    console.error(err)
    return toolError('Something went wrong on our side. Nothing was confirmed as changed; check the ledger.')
  }
}
