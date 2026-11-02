// Write MCP tools. They go through the same domain services as the API, so every invariant (legal directions,
// FIFO, immutability, idempotency) is shared. Every API write is exposed; payment voids do not exist anywhere.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { InvoiceController } from '@/api/invoice.controller'
import { PartyController } from '@/api/party.controller'
import {
  BatchId,
  InvoiceBatchResult,
  InvoiceCreate,
  InvoiceDetail,
  InvoiceSplit,
  Party,
  PartyCreate,
  Payment,
  PaymentCreate,
  SplitResult
} from '@/api/schemas'
import { Invalid } from '@/domain/errors'
import { createPayment, getInvoice, previewSplit, replaySplit, voidInvoice } from '@/domain/services'
import { ME } from '@/ledger'

import type { McpToolContext } from '../context'
import { cents, jsonResult, withToolErrors } from './util'

const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const

/** A line item as tools take it: the expense category is required and money is integer cents. */
const ToolLineItem = z.object({
  description: z.string().min(1),
  category: z.string().min(1).describe('Expense category, e.g. utilities'),
  amountCents: cents('Line amount')
})

export function registerWriteTools(server: McpServer, { ctx }: McpToolContext): void {
  const invoices = new InvoiceController()
  const partyApi = new PartyController()
  const now = (): string => new Date().toISOString()

  server.registerTool(
    'create_party',
    {
      title: 'Add a party',
      description:
        'Add a roommate or a provider (ConEd, internet, ...). There is exactly one "me" party and it already ' +
        'exists. Call list_parties first so you do not add a duplicate. Roommates should carry their Venmo handle ' +
        '(without the @) so get_balances can build request links; providers have none. Supplying `id` (a short ' +
        'slug such as "coned") makes a retry safe: reusing an existing id is rejected instead of adding a second ' +
        'party. Parties cannot be renamed or deleted here.',
      inputSchema: {
        ...PartyCreate.shape,
        id: PartyCreate.shape.id.describe('Optional stable id, e.g. "coned"; a random id is generated if omitted'),
        venmoHandle: z.string().min(1).nullable().optional().describe('Roommates only: Venmo handle without the @')
      },
      outputSchema: Party.shape,
      annotations: { ...WRITE, idempotentHint: false, title: 'Add a party' }
    },
    ({ venmoHandle, ...party }) =>
      withToolErrors(async () => {
        const created = await partyApi.create(ctx, { ...party, venmoHandle: venmoHandle ?? null })
        return jsonResult(`Added ${created.kind} ${created.name} (${created.id})`, created)
      })
  )

  server.registerTool(
    'create_invoice',
    {
      title: 'Create an invoice',
      description:
        'Create one invoice in either legal direction: a roommate owes me (payerId = roommate, payeeId = "me"), ' +
        'or I owe a provider (payerId = "me", payeeId = provider). Use it for one-off roommate charges (groceries, ' +
        'a shared purchase); prefer record_provider_bill for provider bills and preview_split + ' +
        'create_split_invoices for splitting bills. Supplying `id` makes a retry safe: reusing an id is rejected. ' +
        'Invoices cannot be edited; to correct one, void it and create a new one.',
      inputSchema: {
        ...InvoiceCreate.shape,
        id: InvoiceCreate.shape.id.describe('Optional idempotency key (a second use of the id is rejected)'),
        issuedAt: InvoiceCreate.shape.issuedAt.describe('When it was issued; defaults to now'),
        lineItems: z.array(ToolLineItem).min(1)
      },
      outputSchema: InvoiceDetail.shape,
      annotations: { ...WRITE, idempotentHint: false, title: 'Create an invoice' }
    },
    input =>
      withToolErrors(async () => {
        const created = await invoices.create(ctx, input)
        return jsonResult(
          `Created invoice ${created.id}: ${created.payerId} owes ${created.payeeId} ${String(created.amountCents)} cents`,
          created
        )
      })
  )

  server.registerTool(
    'create_roommate_invoices',
    {
      title: 'Create roommate invoices',
      description:
        'Create several roommate invoices at once (each payer is a roommate, the payee is always me), e.g. ' +
        'hand-built charges that are not a straight bill split. All or nothing. `batchId` is an optional ' +
        'idempotency key: reuse it on retry and the same request returns the invoices already created, while a ' +
        'different request under the same batchId is a conflict. Without it a retry creates duplicates.',
      inputSchema: {
        invoices: z
          .array(
            z.object({
              payerId: z.string().min(1).describe('A roommate id from list_parties'),
              description: z.string(),
              dueDate: z.iso.date(),
              issuedAt: z.iso.datetime().optional().describe('Defaults to now'),
              lineItems: z.array(ToolLineItem).min(1)
            })
          )
          .min(1),
        batchId: BatchId.optional().describe('Idempotency key, unique per intended batch, reused on retry')
      },
      outputSchema: InvoiceBatchResult.shape,
      annotations: { ...WRITE, idempotentHint: true, title: 'Create roommate invoices' }
    },
    input =>
      withToolErrors(async () => {
        const result = await invoices.createBatch(ctx, input)
        return jsonResult(
          `Created ${String(result.invoices.length)} invoices totalling ${String(result.invoices.reduce((s, i) => s + i.amountCents, 0))} cents`,
          result
        )
      })
  )

  server.registerTool(
    'record_payment',
    {
      title: 'Record a payment',
      description:
        'Record money that actually moved between me and one other party (roommate -> me, or me -> provider). The ' +
        '`id` is YOUR idempotency key: generate a fresh unique id per real payment and reuse it when retrying; ' +
        'replaying the same id with the same details returns the stored payment, different details is a conflict. ' +
        "Payments are applied FIFO to the pair's oldest invoices. PAYMENTS CANNOT BE VOIDED or edited once " +
        'recorded, so confirm payer, payee, amount and date with the user first.',
      inputSchema: {
        ...PaymentCreate.shape,
        id: z.string().min(1).describe('Idempotency key: unique per real payment, reused on retry'),
        amountCents: cents('Amount paid'),
        paidAt: PaymentCreate.shape.paidAt.describe('When it was paid; defaults to now')
      },
      outputSchema: Payment.shape,
      annotations: { ...WRITE, idempotentHint: true, title: 'Record a payment' }
    },
    input =>
      withToolErrors(async () => {
        const payment = await createPayment(ctx.db, input, now())
        return jsonResult(
          `Recorded ${String(payment.amountCents)} cents from ${payment.payerId} to ${payment.payeeId}`,
          payment
        )
      })
  )

  server.registerTool(
    'record_provider_bill',
    {
      title: 'Record a provider bill',
      description:
        'Record a bill a provider (ConEd, internet, ...) sent me. Payer is always me, the payee is `providerId`. ' +
        'Line items carry the expense category; amounts are integer cents. Supplying `id` makes a retry safe: ' +
        'reusing an id fails with a conflict instead of creating a second bill. Bills cannot be edited; to correct ' +
        'one, void it and record a new one.',
      inputSchema: {
        providerId: z.string().min(1).describe('A provider id from list_parties'),
        id: InvoiceCreate.shape.id.describe('Optional idempotency key (a second use of the id is rejected)'),
        description: InvoiceCreate.shape.description,
        dueDate: InvoiceCreate.shape.dueDate,
        issuedAt: InvoiceCreate.shape.issuedAt.describe('When the bill was issued; defaults to now'),
        lineItems: z
          .array(
            z.object({
              description: z.string().min(1),
              category: z.string().min(1).describe('Expense category, e.g. utilities'),
              amountCents: cents('Line amount')
            })
          )
          .min(1)
      },
      outputSchema: InvoiceDetail.shape,
      annotations: { ...WRITE, idempotentHint: false, title: 'Record a provider bill' }
    },
    ({ providerId, ...bill }) =>
      withToolErrors(async () => {
        const created = await invoices.create(ctx, { ...bill, payerId: ME, payeeId: providerId })
        return jsonResult(`Recorded bill ${created.id} for ${String(created.amountCents)} cents`, created)
      })
  )

  server.registerTool(
    'request_invoice',
    {
      title: 'Mark invoice as requested',
      description:
        'Mark one of my roommate invoices as requested (the Venmo request was sent by the user). This only changes ' +
        'the status; it sends nothing. Use the Venmo link from get_balances for the user to open. Fails if the ' +
        'invoice is already requested or void.',
      inputSchema: { id: z.string().min(1) },
      outputSchema: InvoiceDetail.shape,
      annotations: { ...WRITE, idempotentHint: false, title: 'Mark invoice as requested' }
    },
    ({ id }) =>
      withToolErrors(async () => {
        const invoice = await invoices.request(ctx, { id })
        return jsonResult(`Invoice ${id} is now ${invoice.status}`, invoice)
      })
  )

  server.registerTool(
    'create_split_invoices',
    {
      title: 'Create split invoices',
      description:
        'Create one combined invoice per roommate from provider bills (the same split preview_split shows). Call ' +
        'preview_split first, show the user, and pass its `totalCents` as `expectedTotalCents` and its draft count ' +
        'as `expectedDraftCount`; if the recomputed split differs, nothing is created. `batchId` is your ' +
        'idempotency key: generate one per intended split and reuse it on retry. The same batchId with the same ' +
        'request returns the invoices already created; with a different request it is a conflict. All amounts ' +
        'are integer cents.',
      inputSchema: {
        ...InvoiceSplit.shape,
        batchId: BatchId.describe('Idempotency key, unique per intended split, reused on retry'),
        expectedTotalCents: cents("The preview's totalCents (sum of the selected provider bills)"),
        expectedDraftCount: z.number().int().describe("The preview's number of drafts")
      },
      outputSchema: SplitResult.shape,
      annotations: { ...WRITE, idempotentHint: true, title: 'Create split invoices' }
    },
    ({ batchId, expectedTotalCents, expectedDraftCount, ...split }) =>
      withToolErrors(async () => {
        // A replay is answered from the stored batch, before the (possibly since-changed) preview is consulted.
        const replay = await replaySplit(ctx.db, split, batchId)
        if (!replay) {
          const preview = await previewSplit(ctx.db, split, now())
          if (preview.totalCents !== expectedTotalCents || preview.drafts.length !== expectedDraftCount) {
            throw new Invalid(
              `The split now comes to ${String(preview.totalCents)} cents in ${String(preview.drafts.length)} drafts, ` +
                `not the expected ${String(expectedTotalCents)} cents in ${String(expectedDraftCount)}. Nothing was created; run preview_split again.`
            )
          }
        }
        const result = await invoices.split(ctx, { ...split, batchId })
        return jsonResult(
          `${replay ? 'Already created: ' : 'Created '}${String(result.invoices.length)} invoices totalling ${String(result.invoices.reduce((s, i) => s + i.amountCents, 0))} cents`,
          result
        )
      })
  )

  server.registerTool(
    'void_invoice',
    {
      title: 'Void an invoice',
      description:
        'PERMANENTLY void an invoice: it is reversed in the ledger and can never be reissued under the same id. ' +
        'This cannot be undone. To prevent mistakes you must repeat the id as `confirmInvoiceId` and state the ' +
        "invoice's `expectedAmountCents` (integer cents, from get_invoice); a mismatch voids nothing. Only void " +
        'after the user has explicitly agreed.',
      inputSchema: {
        id: z.string().min(1),
        confirmInvoiceId: z.string().min(1).describe('Must equal `id`'),
        expectedAmountCents: cents('The invoice amount you expect it to have')
      },
      outputSchema: InvoiceDetail.shape,
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: false, title: 'Void an invoice' }
    },
    ({ id, confirmInvoiceId, expectedAmountCents }) =>
      withToolErrors(async () => {
        if (confirmInvoiceId !== id) throw new Invalid('confirmInvoiceId must equal id; nothing was voided')
        const invoice = await getInvoice(ctx.db, id)
        if (invoice.amountCents !== expectedAmountCents) {
          throw new Invalid(
            `Invoice ${id} is ${String(invoice.amountCents)} cents, not the expected ${String(expectedAmountCents)}; nothing was voided`
          )
        }
        await voidInvoice(ctx.db, id, now())
        const voided = await invoices.get(ctx, { id })
        return jsonResult(`Voided invoice ${id}`, voided)
      })
  )
}
