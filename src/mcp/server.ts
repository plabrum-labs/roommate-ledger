import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { getParty } from '@/domain/queries'

import type { McpToolContext } from './context'
import { registerReadTools } from './tools/reads'
import { jsonResult, withToolErrors } from './tools/util'
import { registerWriteTools } from './tools/writes'
import { Party } from '@/api/schemas'
import { z } from 'zod'

const INSTRUCTIONS = `Roommate Ledger: a double-entry ledger for the utility bills I (the signed-in owner) pay and \
what my roommates owe me for them.

Parties are me, roommates and providers (ConEd, internet, ...). A roommate's account is a receivable (what they owe \
me, negative is credit); a provider's is a payable (what I owe them). Payments are applied FIFO to a party's oldest \
non-void invoices, so there is no payment-to-invoice pinning. All money is integer cents everywhere (1234 = $12.34).

Writes are real money records. Confirm the details with the user before calling any write tool. For a split, call \
preview_split first and show the drafts, then create_split_invoices with the previewed total and draft count. \
Voiding an invoice is permanent, and recorded payments cannot be voided. This server sends nothing: request_invoice \
only marks an invoice as requested, and the Venmo link comes from get_balances for the user to open.`

export function buildMcpServer(tools: McpToolContext): McpServer {
  const server = new McpServer({ name: 'roommate-ledger', version: '1.0.0' }, { instructions: INSTRUCTIONS })

  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description: 'The Access identity of this connection and the ledger party it acts as ("me").',
      outputSchema: { email: z.string().nullable(), me: Party.nullable() },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    () =>
      withToolErrors(async () => {
        const email = tools.identity.kind === 'verified' ? tools.identity.email : null
        const me = (await getParty(tools.ctx.db, tools.ctx.me)) ?? null
        return jsonResult(`Signed in as ${email ?? 'the local dev user'}`, { email, me })
      })
  )

  registerReadTools(server, tools)
  registerWriteTools(server, tools)
  return server
}
