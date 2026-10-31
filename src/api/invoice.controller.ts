import { z } from 'zod'

import { listInvoices, transitionsOf } from '@/domain/queries'
import { ME } from '@/ledger'
import {
  createInvoice,
  createInvoices,
  fingerprintOf,
  getInvoiceWithLines,
  invoiceRoommates,
  previewSplit,
  requestInvoice,
  voidInvoice
} from '@/domain/services'

import type { Ctx } from './context'
import { presentInvoice, presentInvoiceDetail } from './present'
import { get, post } from './routes'
import {
  IdParam,
  InvoiceBatchCreate,
  InvoiceBatchResult,
  InvoiceCreate,
  InvoiceDetail,
  InvoiceListQuery,
  InvoiceSplit,
  InvoiceSplitCreate,
  InvoiceSummary,
  SplitPreview,
  SplitResult
} from './schemas'

const tags = ['invoices']
const now = (): string => new Date().toISOString()

export class InvoiceController {
  @get('/invoices', {
    operationId: 'listInvoices',
    params: InvoiceListQuery,
    returns: z.array(InvoiceSummary),
    tags
  })
  async list(ctx: Ctx, query: InvoiceListQuery): Promise<InvoiceSummary[]> {
    return (await listInvoices(ctx.db, query)).map(({ lineCount, ...invoice }) => presentInvoice(invoice, lineCount))
  }

  // The literal `/invoices/split*` and `/invoices/batch` paths are declared before `/invoices/{id}`.
  @post('/invoices/split/preview', {
    operationId: 'previewSplit',
    body: InvoiceSplit,
    returns: SplitPreview,
    tags
  })
  async previewSplit(ctx: Ctx, data: InvoiceSplit): Promise<SplitPreview> {
    return previewSplit(ctx.db, data, now())
  }

  @post('/invoices/split', {
    operationId: 'invoiceRoommates',
    body: InvoiceSplitCreate,
    returns: SplitResult,
    status: 201,
    tags
  })
  async split(ctx: Ctx, { batchId, ...data }: InvoiceSplitCreate): Promise<SplitResult> {
    const result = await invoiceRoommates(ctx.db, data, now(), undefined, batchId)
    return { ...result, invoices: result.invoices.map(inv => presentInvoice(inv, inv.lineItems.length)) }
  }

  @post('/invoices/batch', {
    operationId: 'createInvoices',
    body: InvoiceBatchCreate,
    returns: InvoiceBatchResult,
    status: 201,
    tags
  })
  async createBatch(ctx: Ctx, data: InvoiceBatchCreate): Promise<InvoiceBatchResult> {
    const issuedAt = now()
    const created = await createInvoices(
      ctx.db,
      data.invoices.map(draft => ({
        ...draft,
        id: crypto.randomUUID(),
        payeeId: ME,
        issuedAt: draft.issuedAt ?? issuedAt
      })),
      data.batchId === undefined
        ? undefined
        : {
            id: data.batchId,
            // An omitted issuedAt means "now", so it cannot be part of what a replay is compared on.
            fingerprint: await fingerprintOf({
              kind: 'batch',
              invoices: data.invoices.map(d => ({ ...d, issuedAt: d.issuedAt ?? null }))
            })
          },
      issuedAt
    )
    return { invoices: created.map(inv => presentInvoiceDetail(inv, [])) }
  }

  @get('/invoices/{id}', { operationId: 'getInvoice', params: IdParam, returns: InvoiceDetail, tags })
  async get(ctx: Ctx, { id }: IdParam): Promise<InvoiceDetail> {
    return this.detail(ctx, id)
  }

  @post('/invoices', {
    operationId: 'createInvoice',
    body: InvoiceCreate,
    returns: InvoiceDetail,
    status: 201,
    tags
  })
  async create(ctx: Ctx, data: InvoiceCreate): Promise<InvoiceDetail> {
    const invoice = await createInvoice(ctx.db, {
      ...data,
      id: data.id ?? crypto.randomUUID(),
      issuedAt: data.issuedAt ?? now()
    })
    return this.detail(ctx, invoice.id)
  }

  @post('/invoices/{id}/request', { operationId: 'requestInvoice', params: IdParam, returns: InvoiceDetail, tags })
  async request(ctx: Ctx, { id }: IdParam): Promise<InvoiceDetail> {
    await requestInvoice(ctx.db, id, now())
    return this.detail(ctx, id)
  }

  @post('/invoices/{id}/void', { operationId: 'voidInvoice', params: IdParam, returns: InvoiceDetail, tags })
  async void(ctx: Ctx, { id }: IdParam): Promise<InvoiceDetail> {
    await voidInvoice(ctx.db, id, now())
    return this.detail(ctx, id)
  }

  private async detail(ctx: Ctx, id: string): Promise<InvoiceDetail> {
    const [invoice, transitions] = await Promise.all([getInvoiceWithLines(ctx.db, id), transitionsOf(ctx.db, id)])
    return presentInvoiceDetail(invoice, transitions)
  }
}
