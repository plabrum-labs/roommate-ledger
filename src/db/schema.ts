import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const PARTY_KINDS = ['me', 'roommate', 'provider'] as const
export const INVOICE_STATUSES = ['issued', 'requested', 'void'] as const
export const SETTLEMENTS = ['unpaid', 'partially_paid', 'paid'] as const
export const PAYMENT_METHODS = ['venmo', 'zelle', 'cash', 'provider_portal'] as const
export const ACCOUNT_KINDS = ['receivable', 'payable', 'cash', 'expense'] as const
/** Must equal the keys of the entry registry in src/ledger/entries.ts (asserted there at compile time). */
export const ENTRY_KINDS = ['invoiceIssued', 'payment'] as const

export const parties = sqliteTable('parties', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: PARTY_KINDS }).notNull(),
  venmoHandle: text('venmo_handle')
})

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ACCOUNT_KINDS }).notNull()
})

export const invoices = sqliteTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    payerId: text('payer_id')
      .notNull()
      .references(() => parties.id),
    payeeId: text('payee_id')
      .notNull()
      .references(() => parties.id),
    /** Denormalised: sum of the invoice's line items, maintained by trigger. */
    amountCents: integer('amount_cents').notNull(),
    description: text('description').notNull(),
    issuedAt: text('issued_at').notNull(),
    dueDate: text('due_date').notNull(),
    status: text('status', { enum: INVOICE_STATUSES }).notNull().default('issued'),
    settlement: text('settlement', { enum: SETTLEMENTS }).notNull().default('unpaid'),
    appliedCents: integer('applied_cents').notNull().default(0)
  },
  t => [
    check('invoices_amount_positive', sql`${t.amountCents} > 0`),
    check('invoices_applied_range', sql`${t.appliedCents} >= 0 AND ${t.appliedCents} <= ${t.amountCents}`),
    check('invoices_parties_differ', sql`${t.payerId} != ${t.payeeId}`),
    index('invoices_payer_idx').on(t.payerId, t.issuedAt),
    index('invoices_payee_idx').on(t.payeeId, t.issuedAt)
  ]
)

export const invoiceLineItems = sqliteTable(
  'invoice_line_items',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    /** Expense category; the invoice's ledger entry debits/credits `expense:<category>` per line. */
    category: text('category').notNull(),
    amountCents: integer('amount_cents').notNull()
  },
  t => [
    check('invoice_line_items_amount_positive', sql`${t.amountCents} > 0`),
    index('invoice_line_items_invoice_idx').on(t.invoiceId, t.position)
  ]
)

export const invoiceTransitions = sqliteTable(
  'invoice_transitions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    fromStatus: text('from_status', { enum: INVOICE_STATUSES }).notNull(),
    toStatus: text('to_status', { enum: INVOICE_STATUSES }).notNull(),
    at: text('at').notNull(),
    note: text('note')
  },
  t => [index('invoice_transitions_invoice_idx').on(t.invoiceId, t.id)]
)

export const payments = sqliteTable(
  'payments',
  {
    id: text('id').primaryKey(),
    payerId: text('payer_id')
      .notNull()
      .references(() => parties.id),
    payeeId: text('payee_id')
      .notNull()
      .references(() => parties.id),
    amountCents: integer('amount_cents').notNull(),
    paidAt: text('paid_at').notNull(),
    method: text('method', { enum: PAYMENT_METHODS }).notNull(),
    reference: text('reference')
  },
  t => [
    check('payments_amount_positive', sql`${t.amountCents} > 0`),
    index('payments_payer_idx').on(t.payerId, t.paidAt),
    index('payments_payee_idx').on(t.payeeId, t.paidAt)
  ]
)

export const ledgerEntries = sqliteTable(
  'ledger_entries',
  {
    id: text('id').primaryKey(),
    entryGroupId: text('entry_group_id').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    amountCents: integer('amount_cents').notNull(),
    occurredAt: text('occurred_at').notNull(),
    kind: text('kind', { enum: ENTRY_KINDS }).notNull(),
    reversesGroupId: text('reverses_group_id'),
    partyLeg: integer('party_leg', { mode: 'boolean' }).notNull(),
    invoiceId: text('invoice_id').references(() => invoices.id),
    paymentId: text('payment_id').references(() => payments.id)
  },
  t => [
    check('ledger_entries_one_source', sql`(${t.invoiceId} IS NULL) != (${t.paymentId} IS NULL)`),
    check('ledger_entries_nonzero', sql`${t.amountCents} != 0`),
    index('ledger_entries_account_time_idx').on(t.accountId, t.occurredAt, t.amountCents),
    index('ledger_entries_account_kind_invoice_idx').on(t.accountId, t.kind, t.invoiceId),
    index('ledger_entries_group_idx').on(t.entryGroupId),
    index('ledger_entries_reverses_idx').on(t.reversesGroupId),
    index('ledger_entries_invoice_idx').on(t.invoiceId),
    index('ledger_entries_payment_idx').on(t.paymentId)
  ]
)
