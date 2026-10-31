// Mirrors soren-em-wedding src/server/mcp/test-support.ts; extract on third use.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import type { Db } from '@/db/client'
import { ME } from '@/ledger'
import { freshDb } from '@/testing/helpers'

import { buildMcpServer } from './server'

/** An SDK Client wired to `buildMcpServer` over an in-memory transport, on a freshly reset local D1. */
export async function connectTestClient(): Promise<{
  client: Client
  db: Db
  callTool: (name: string, args?: Record<string, unknown>, o?: { allowError?: boolean }) => Promise<unknown>
  close: () => Promise<void>
}> {
  const db = await freshDb()
  const server = buildMcpServer({ ctx: { db, me: ME }, identity: { kind: 'dev_bypass' } })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(clientSide)

  /** Calls a tool; returns its structuredContent. Throws on isError unless `{allowError: true}`, in which case an
   *  error returns `{isError: true, text}`. */
  async function callTool(
    name: string,
    args: Record<string, unknown> = {},
    o: { allowError?: boolean } = {}
  ): Promise<unknown> {
    const result = await client.callTool({ name, arguments: args })
    const content = result.content as { type: string; text?: string }[]
    const text = content.map(c => c.text ?? '').join('\n')
    if (result.isError) {
      if (o.allowError) return { isError: true, text }
      throw new Error(`Tool ${name} failed: ${text}`)
    }
    return result.structuredContent
  }

  return { client, db, callTool, close: () => client.close() }
}
