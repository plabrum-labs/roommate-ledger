// Read-only MCP tools. Each reuses the API controllers' read paths (and so their presenters and schemas); nothing
// here writes.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { InvoiceController } from '@/api/invoice.controller'
import { LedgerController } from '@/api/ledger.controller'
import { PartyController } from '@/api/party.controller'
import { PaymentController } from '@/api/payment.controller'
import {
  Balances,
  InvoiceDetail,
  InvoiceListQuery,
  InvoiceSplit,
  InvoiceSummary,
  Party,
  Payment,
  Posting,
  PostingParam,
  SplitPreview,
  Statement
} from '@/api/schemas'
import { Invalid, NotFound } from '@/domain/errors'
import { getParty } from '@/domain/queries'
import { previewSplit } from '@/domain/services'

import type { McpToolContext } from '../context'
import { jsonResult, withToolErrors } from './util'

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const

const plural = (n: number, one: string, many = `${one}s`): string => `${String(n)} ${n === 1 ? one : many}`

export function registerReadTools(server: McpServer, { ctx }: McpToolContext): void {
  const parties = new PartyController()
  const invoices = new InvoiceController()
  const payments = new PaymentController()
  const ledger = new LedgerController()

  server.registerTool(
    'list_parties',
    {
      title: 'List parties',
      description: 'Everyone in the ledger: me, the roommates and the providers, with ids and Venmo handles.',
      outputSchema: { parties: z.array(Party) },
      annotations: { ...READ_ONLY, title: 'List parties' }
    },
    () =>
      withToolErrors(async () => {
        const list = await parties.list(ctx)
        return jsonResult(plural(list.length, 'party', 'parties'), { parties: list })
      })
  )

  server.registerTool(
    'get_balances',
    {
      title: 'Balances',
      description:
        'What each roommate owes me (negative is credit; amounts in integer cents), what I owe each provider, the ' +
        'totals, and for each roommate who owes something a Venmo charge link to open (this server never sends it).',
      outputSchema: Balances.shape,
      annotations: { ...READ_ONLY, title: 'Balances' }
    },
    () =>
      withToolErrors(async () => {
        const balances = await ledger.balances(ctx)
        return jsonResult(
          `Owed to me ${String(balances.totalOwedToMeCents)} cents; I owe ${String(balances.totalIOweCents)} cents`,
          balances
        )
      })
  )

  server.registerTool(
    'get_statement',
    {
      title: 'Statement',
      description:
        'The dated lines (invoices, payments, voids) of one account with a running balance, from the party ' +
        "perspective (positive means they owe more / I owe more; integer cents). Give `partyId` (a roommate's " +
        "receivable or a provider's payable is chosen for you) or an explicit `accountId` such as `cash` or " +
        '`expense:utilities`, not both. `from`/`to` are ISO datetimes bounding the lines.',
      inputSchema: {
        partyId: z.string().min(1).optional().describe('A roommate or provider id from list_parties'),
        accountId: z.string().min(1).optional().describe('An account id, e.g. receivable:sam, cash, expense:groceries'),
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional()
      },
      outputSchema: Statement.shape,
      annotations: { ...READ_ONLY, title: 'Statement' }
    },
    ({ partyId, accountId, from, to }) =>
      withToolErrors(async () => {
        if ((partyId === undefined) === (accountId === undefined)) {
          throw new Invalid('Give exactly one of partyId or accountId')
        }
        const id = accountId ?? (await accountOfParty(ctx.db, partyId ?? ''))
        const statement = await ledger.statement(ctx, { id, from, to })
        return jsonResult(
          `${plural(statement.lines.length, 'line')} on ${statement.accountId}; closing balance ${String(statement.closingBalanceCents)} cents`,
          statement
        )
      })
  )

  server.registerTool(
    'get_posting',
    {
      title: 'Posting',
      description:
        'One ledger entry group (as found in a statement line) as debit/credit lines, with a balanced check. ' +
        'Amounts are integer cents.',
      inputSchema: PostingParam.shape,
      outputSchema: Posting.shape,
      annotations: { ...READ_ONLY, title: 'Posting' }
    },
    ({ entryGroupId }) =>
      withToolErrors(async () => {
        const posting = await ledger.posting(ctx, { entryGroupId })
        return jsonResult(`Posting ${entryGroupId}: ${posting.balanced ? 'balanced' : 'NOT balanced'}`, posting)
      })
  )

  server.registerTool(
    'list_invoices',
    {
      title: 'List invoices',
      description:
        'Invoices, oldest first as the ledger holds them. `direction` incoming = provider bills I owe, outgoing = ' +
        'what I invoiced roommates. Amounts are integer cents.',
      inputSchema: InvoiceListQuery.shape,
      outputSchema: { invoices: z.array(InvoiceSummary) },
      annotations: { ...READ_ONLY, title: 'List invoices' }
    },
    query =>
      withToolErrors(async () => {
        const list = await invoices.list(ctx, query)
        return jsonResult(plural(list.length, 'invoice'), { invoices: list })
      })
  )

  server.registerTool(
    'get_invoice',
    {
      title: 'Get invoice',
      description:
        'One invoice with its line items, status transitions and the lifecycle moves still allowed. Amounts are ' +
        'integer cents.',
      inputSchema: { id: z.string().min(1) },
      outputSchema: InvoiceDetail.shape,
      annotations: { ...READ_ONLY, title: 'Get invoice' }
    },
    ({ id }) =>
      withToolErrors(async () => {
        const invoice = await invoices.get(ctx, { id })
        return jsonResult(`${invoice.description}: ${invoice.status}, ${invoice.settlement ?? 'void'}`, invoice)
      })
  )

  server.registerTool(
    'list_payments',
    {
      title: 'List payments',
      description: 'Recorded payments, optionally only those involving one party. Amounts are integer cents.',
      inputSchema: { partyId: z.string().min(1).optional() },
      outputSchema: { payments: z.array(Payment) },
      annotations: { ...READ_ONLY, title: 'List payments' }
    },
    ({ partyId }) =>
      withToolErrors(async () => {
        const list = await payments.list(ctx, { partyId })
        return jsonResult(plural(list.length, 'payment'), { payments: list })
      })
  )

  server.registerTool(
    'preview_split',
    {
      title: 'Preview a split',
      description:
        'Dry run of splitting provider bills equally across roommates and me: one draft invoice per roommate, ' +
        'exact to the cent, writing nothing. Show the drafts to the user, then pass `totalCents` and the draft ' +
        'count as `expectedTotalCents` / `expectedDraftCount` to create_split_invoices. All amounts are integer cents.',
      inputSchema: InvoiceSplit.shape,
      outputSchema: SplitPreview.shape,
      annotations: { ...READ_ONLY, title: 'Preview a split' }
    },
    input =>
      withToolErrors(async () => {
        const preview = await previewSplit(ctx.db, input, new Date().toISOString())
        return jsonResult(
          `${plural(preview.drafts.length, 'draft')} for ${String(preview.totalCents)} cents total; my share ${String(preview.myShareCents)}`,
          { ...preview }
        )
      })
  )
}

/** A roommate's account is its receivable, a provider's its payable. */
async function accountOfParty(db: McpToolContext['ctx']['db'], partyId: string): Promise<string> {
  const party = await getParty(db, partyId)
  if (!party) throw new NotFound(`Party ${partyId} not found`)
  if (party.kind === 'me') throw new Invalid('"me" has no receivable or payable; pass an accountId such as cash')
  return party.kind === 'roommate' ? `receivable:${party.id}` : `payable:${party.id}`
}
