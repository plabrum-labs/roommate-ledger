import { and, asc, eq, ne, sql } from 'drizzle-orm'

import type { Db } from '@/db/client'
import { invoiceBatches, invoiceLineItems, invoices, invoiceTransitions, parties, payments } from '@/db/schema'
import { ledger, ME } from '@/ledger'

import { Conflict, Invalid, NotFound } from './errors'
import { sumCents, type Invoice, type InvoiceWithLines, type NewInvoice, type NewLineItem } from './invoice'
import { assertAllowed } from './invoice-state'
import type { Party } from './party'
import type { Payment } from './payment'
import { getParties, getParty, invoicesByIds, invoicesWithLines } from './queries'
import { splitBills } from './split'

export async function getInvoice(db: Db, id: string): Promise<Invoice> {
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id))
  if (!row) throw new NotFound(`Invoice ${id} not found`)
  return row
}

export async function getInvoiceWithLines(db: Db, id: string): Promise<InvoiceWithLines> {
  const [row] = await invoicesWithLines(db, [id])
  if (!row) throw new NotFound(`Invoice ${id} not found`)
  return row
}

/** The invoice with its lines as they will be stored, which is also the document the ledger posts; the amount is the sum of the lines. */
function issued(input: NewInvoice): InvoiceWithLines {
  const { lineItems, ...rest } = input
  return {
    ...rest,
    amountCents: sumCents(lineItems),
    status: 'issued',
    settlement: 'unpaid',
    appliedCents: 0,
    lineItems: lineItems.map((line, position) => ({
      ...line,
      id: crypto.randomUUID(),
      invoiceId: input.id,
      position
    }))
  }
}

/**
 * Statements issuing one invoice, in the order the triggers need: the invoice (with its precomputed
 * amount, so the CHECK holds), then its lines (the sum trigger recomputes the same amount), then the
 * ledger lines (after which the lines are frozen and the settlement trigger sees everything).
 */
function issueStatements(db: Db, doc: InvoiceWithLines, batchId: string | null = null) {
  const { lineItems, ...invoice } = doc
  return [
    db.insert(invoices).values({ ...invoice, batchId }),
    db.insert(invoiceLineItems).values(lineItems),
    ...ledger(db).post('invoiceIssued', doc)
  ] as const
}

export async function issueInvoice(db: Db, input: NewInvoice): Promise<InvoiceWithLines> {
  const doc = issued(input)
  await db.batch(issueStatements(db, doc))
  return getInvoiceWithLines(db, doc.id)
}

export async function createParty(db: Db, party: Party): Promise<Party> {
  if (party.kind === 'me') throw new Invalid('There is exactly one "me" party')
  if (await getParty(db, party.id)) throw new Conflict(`Party ${party.id} already exists`)
  await db.insert(parties).values(party)
  return party
}

/** A document is between me and one other party: a roommate invoice (payer roommate, payee me) or a provider bill (payer me, payee provider). */
function assertMeAndCounterparty(found: readonly Party[], payerId: string, payeeId: string, what: string): void {
  const payer = found.find(p => p.id === payerId)
  const payee = found.find(p => p.id === payeeId)
  if (!payer) throw new Invalid(`Unknown payer ${payerId}`)
  if (!payee) throw new Invalid(`Unknown payee ${payeeId}`)
  const roommateInvoice = payee.id === ME && payer.kind === 'roommate'
  const providerBill = payer.id === ME && payee.kind === 'provider'
  if (!roommateInvoice && !providerBill) {
    throw new Invalid(`A ${what} must be roommate -> me or me -> provider`)
  }
}

/** Validated invoice creation: parties exist, direction is legal, id is unused. */
export async function createInvoice(db: Db, input: NewInvoice): Promise<InvoiceWithLines> {
  assertMeAndCounterparty(await getParties(db, [input.payerId, input.payeeId]), input.payerId, input.payeeId, 'invoice')
  const [existing] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, input.id))
  if (existing) throw new Conflict(`Invoice ${input.id} already exists`)
  return issueInvoice(db, input)
}

/** Idempotency key for a bulk create: the client's batch id and a hash of what the request asked for. */
export interface BatchKey {
  id: string
  fingerprint: string
}

/** SHA-256 of the JSON encoding of `value`; callers pass already-normalised data so equal requests encode equally. */
export async function fingerprintOf(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The invoices a batch already created, in creation order; null when the batch is new. The same id
 * with a different request is a Conflict, never a silent second create.
 */
export async function replayBatch(db: Db, batch: BatchKey): Promise<InvoiceWithLines[] | null> {
  const [existing] = await db.select().from(invoiceBatches).where(eq(invoiceBatches.id, batch.id))
  if (!existing) return null
  if (existing.fingerprint !== batch.fingerprint) {
    throw new Conflict(`Batch ${batch.id} was already used for a different request`)
  }
  const rows = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.batchId, batch.id))
    .orderBy(asc(sql`rowid`))
  return invoicesWithLines(
    db,
    rows.map(r => r.id)
  )
}

/**
 * Roommate invoices (payee = me), all issued in a single D1 batch: either every invoice exists afterwards or none.
 * With a `batch` key the create is idempotent: the key row is inserted in the same D1 batch, so it exists
 * exactly when the invoices do, and a replay returns them instead of creating more.
 */
export async function createInvoices(
  db: Db,
  inputs: readonly NewInvoice[],
  batch?: BatchKey,
  now: string = new Date().toISOString()
): Promise<InvoiceWithLines[]> {
  if (batch) {
    const replay = await replayBatch(db, batch)
    if (replay) return replay
  }
  const ids = inputs.map(i => i.id)
  if (new Set(ids).size !== ids.length) throw new Invalid('Duplicate invoice ids in batch')
  const found = await getParties(db, [ME, ...inputs.map(i => i.payerId)])
  for (const input of inputs) {
    if (input.payeeId !== ME) throw new Invalid('A batch only creates invoices to me')
    assertMeAndCounterparty(found, input.payerId, input.payeeId, 'invoice')
  }
  const existing = await invoicesByIds(db, ids)
  if (existing.length > 0) throw new Conflict(`Invoice ${existing.map(e => e.id).join(', ')} already exists`)
  const docs = inputs.map(issued)
  const statements = docs.flatMap(doc => issueStatements(db, doc, batch?.id ?? null))
  const [first, ...rest] = batch
    ? [db.insert(invoiceBatches).values({ ...batch, createdAt: now }), ...statements]
    : statements
  if (!first) throw new Invalid('No invoices given')
  try {
    await db.batch([first, ...rest])
  } catch (error) {
    // A concurrent request with the same key won the primary-key race; whatever it created is the answer.
    const replay = batch ? await replayBatch(db, batch) : null
    if (replay) return replay
    throw error
  }
  return invoicesWithLines(db, ids)
}

export interface ExtraLine extends NewLineItem {
  roommateId: string
}

export interface InvoiceRoommatesInput {
  providerInvoiceIds: readonly string[]
  roommateIds: readonly string[]
  description?: string
  dueDate: string
  /** Defaults to the `issuedAt` argument of the call. */
  issuedAt?: string
  /** Appended after the bill shares of the named roommate. */
  extraLines?: readonly ExtraLine[]
}

/** A combined invoice before it is written; the preview shows these and a batch create accepts them. */
export interface SplitDraft {
  payerId: string
  description: string
  dueDate: string
  issuedAt: string
  lineItems: NewLineItem[]
  totalCents: number
}

export interface SplitPreview {
  /** Sum of the selected provider bills (extra lines excluded). */
  totalCents: number
  myShareCents: number
  drafts: SplitDraft[]
}

/**
 * Pure planning step shared by preview and create: for every selected provider bill, each line is
 * split equally across the roommates and me (largest remainder; my share is not invoiced), giving
 * each roommate one share line per bill line, followed by their extra lines.
 */
export function previewSplit(db: Db, input: InvoiceRoommatesInput, issuedAt: string): Promise<SplitPreview> {
  return planSplit(db, input, issuedAt, true)
}

/** `requireLive` is off only when re-deriving totals for a replay, where the bills may have been voided since. */
async function planSplit(
  db: Db,
  input: InvoiceRoommatesInput,
  issuedAt: string,
  requireLive: boolean
): Promise<SplitPreview> {
  const providerIds = [...new Set(input.providerInvoiceIds)]
  const roommateIds = [...new Set(input.roommateIds)]
  const bills = await invoicesWithLines(db, providerIds)
  const missing = providerIds.filter(id => !bills.some(b => b.id === id))
  if (missing.length > 0) throw new NotFound(`Provider invoice ${missing.join(', ')} not found`)
  const bad = bills.find(b => b.payerId !== ME || (requireLive && b.status === 'void'))
  if (bad) throw new Invalid(`Invoice ${bad.id} is not a live provider bill`)

  const roommates = await getParties(db, roommateIds)
  const notRoommate = roommateIds.find(id => roommates.find(r => r.id === id)?.kind !== 'roommate')
  if (notRoommate !== undefined) throw new Invalid(`${notRoommate} is not a roommate`)
  const stray = (input.extraLines ?? []).find(e => !roommateIds.includes(e.roommateId))
  if (stray) throw new Invalid(`Extra line for ${stray.roommateId}, who is not among the selected roommates`)

  const { roommateLines, myShareCents } = splitBills(bills, roommateIds.length)
  const description = input.description ?? bills.map(b => b.description).join(', ')
  const drafts = roommateIds.map((payerId, i): SplitDraft => {
    const extras = (input.extraLines ?? [])
      .filter(e => e.roommateId === payerId)
      .map(({ roommateId: _roommate, ...line }) => line)
    const lineItems = [...(roommateLines[i] ?? []), ...extras]
    if (lineItems.length === 0) throw new Invalid('Total is too small to split')
    return {
      payerId,
      description,
      dueDate: input.dueDate,
      issuedAt: input.issuedAt ?? issuedAt,
      lineItems,
      totalCents: sumCents(lineItems)
    }
  })
  return { totalCents: sumCents(bills), myShareCents, drafts }
}

export interface InvoiceRoommatesResult {
  totalCents: number
  myShareCents: number
  invoices: InvoiceWithLines[]
}

/** What a split request asked for, normalised so equal requests hash equally (an omitted `issuedAt` means "now"). */
async function splitKey(batchId: string, input: InvoiceRoommatesInput): Promise<BatchKey> {
  const fingerprint = await fingerprintOf({
    kind: 'split',
    providerInvoiceIds: [...new Set(input.providerInvoiceIds)].sort(),
    roommateIds: [...new Set(input.roommateIds)],
    description: input.description ?? null,
    dueDate: input.dueDate,
    issuedAt: input.issuedAt ?? null,
    extraLines: (input.extraLines ?? []).map(e => [e.roommateId, e.description, e.category, e.amountCents])
  })
  return { id: batchId, fingerprint }
}

/**
 * The result of a split already created under `batchId`, or null when the batch is new. Totals are
 * recomputed from the (immutable) provider bills, which may have been voided since.
 */
export async function replaySplit(
  db: Db,
  input: InvoiceRoommatesInput,
  batchId: string
): Promise<InvoiceRoommatesResult | null> {
  const invoices = await replayBatch(db, await splitKey(batchId, input))
  if (!invoices) return null
  const { totalCents, myShareCents } = await planSplit(db, input, new Date().toISOString(), false)
  return { totalCents, myShareCents, invoices }
}

/**
 * Previews the split, then issues one combined invoice per roommate in a single batch. With a `batchId`
 * the whole call is idempotent: the same id and request returns the invoices already created, the same
 * id with a different request is a Conflict.
 */
export async function invoiceRoommates(
  db: Db,
  input: InvoiceRoommatesInput,
  issuedAt: string,
  newId: () => string = () => crypto.randomUUID(),
  batchId?: string
): Promise<InvoiceRoommatesResult> {
  if (batchId !== undefined) {
    const replay = await replaySplit(db, input, batchId)
    if (replay) return replay
  }
  const { totalCents, myShareCents, drafts } = await previewSplit(db, input, issuedAt)
  const created = await createInvoices(
    db,
    drafts.map(({ totalCents: _total, ...draft }) => ({ ...draft, id: newId(), payeeId: ME })),
    batchId === undefined ? undefined : await splitKey(batchId, input),
    issuedAt
  )
  return { totalCents, myShareCents, invoices: created }
}

export type PaymentInput = Omit<Payment, 'paidAt'> & { paidAt?: string }

/**
 * Validated payment: roommate -> me or me -> provider. Replaying an id with the same content is a
 * no-op; an omitted `paidAt` defaults to `now` and is not part of that comparison.
 */
export async function createPayment(db: Db, input: PaymentInput, now: string): Promise<Payment> {
  assertMeAndCounterparty(await getParties(db, [input.payerId, input.payeeId]), input.payerId, input.payeeId, 'payment')
  const [existing] = await db.select().from(payments).where(eq(payments.id, input.id))
  if (existing) {
    const { paidAt: _stored, ...stored } = existing
    const { paidAt: supplied, ...rest } = input
    const same = JSON.stringify(sortedEntries(stored)) === JSON.stringify(sortedEntries(rest))
    if (!same || (supplied !== undefined && supplied !== existing.paidAt)) {
      throw new Conflict(`Payment ${input.id} already recorded with different details`)
    }
    return existing
  }
  return recordPayment(db, { ...input, paidAt: input.paidAt ?? now })
}

const sortedEntries = (p: object): [string, unknown][] => Object.entries(p).sort(([a], [b]) => a.localeCompare(b))

/** Idempotent on `payment.id`: replaying the same id posts nothing. */
export async function recordPayment(db: Db, payment: Payment): Promise<Payment> {
  const [existing] = await db.select().from(payments).where(eq(payments.id, payment.id))
  if (existing) return existing
  await db.batch([db.insert(payments).values(payment), ...ledger(db).post('payment', payment)])
  return payment
}

export async function requestInvoice(db: Db, id: string, at: string, note: string | null = null): Promise<Invoice> {
  const invoice = await getInvoice(db, id)
  assertAllowed(invoice, 'requested')
  const [update] = await db.batch([
    db
      .update(invoices)
      .set({ status: 'requested' })
      .where(and(eq(invoices.id, id), eq(invoices.status, invoice.status))),
    db
      .insert(invoiceTransitions)
      .select(sql`SELECT NULL, ${id}, ${invoice.status}, 'requested', ${at}, ${note} WHERE changes() > 0`)
  ])
  if (update.meta.changes === 0) throw new Conflict('Invoice changed concurrently')
  return getInvoice(db, id)
}

/** Status update first (so the trigger excludes the invoice), then the idempotent reversal. */
export async function voidInvoice(db: Db, id: string, at: string, note: string | null = null): Promise<Invoice> {
  const invoice = await getInvoiceWithLines(db, id)
  assertAllowed(invoice, 'void')
  const [update] = await db.batch([
    db
      .update(invoices)
      .set({ status: 'void' })
      .where(and(eq(invoices.id, id), ne(invoices.status, 'void'))),
    db
      .insert(invoiceTransitions)
      .select(sql`SELECT NULL, ${id}, ${invoice.status}, 'void', ${at}, ${note} WHERE changes() > 0`),
    ledger(db).reverse('invoiceIssued', invoice, at)
  ])
  if (update.meta.changes === 0) throw new Conflict('Already void')
  return getInvoice(db, id)
}
