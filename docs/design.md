# Roommate Ledger — design

Track the utility bills I pay (ConEd, internet, water) and what my roommates owe me for them.
A provider invoices me, I pay it, I invoice my roommates (whenever I get round to it — possibly
months later, covering several bills at once), they pay me on Venmo.

## Stack

| Layer    | Choice                                                                                                                                                                                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime  | One Cloudflare Worker on the existing Workers Paid account (no marginal cost)                                                                                                                                                                                                                 |
| Data     | D1 (SQLite) via Drizzle. Tables, indexes and CHECKs are declared in `src/db/schema.ts`; `drizzle-kit generate` diffs it into SQL migrations under `drizzle/`, applied by `wrangler d1 migrations apply`. The triggers are the hand-written custom migrations (Drizzle doesn't model triggers) |
| API      | oRPC (`OpenAPIHandler` only) behind an in-repo decorator layer (`src/framework/`)                                                                                                                                                                                                             |
| Contract | oRPC `OpenAPIGenerator` → `openapi.json` → Orval → suspense hooks + query options                                                                                                                                                                                                             |
| Frontend | Vite + React + TanStack Router; loaders prefetch with `ensureQueryData`                                                                                                                                                                                                                       |
| Auth     | Cloudflare Access (one-time PIN) in front of everything; no auth code beyond JWT verification                                                                                                                                                                                                 |

## Domain model

### Parties

```ts
parties: id, name, kind: 'me' | 'roommate' | 'provider', venmoHandle (roommates only)
```

The payment channel is a property of the party, not the invoice.

The single `me` party is created by migration `0003_seed_me_party.sql` (the API refuses to create kind `me`), so a freshly
migrated database already has it.

### Invoices — documents

```ts
invoices:
  id, payerId → parties, payeeId → parties,
  amountCents (int),                                  -- denormalised: sum of line items, maintained by trigger
  description,
  issuedAt  NOT NULL,
  dueDate   NOT NULL,
  status: 'issued' | 'requested' | 'void',            -- lifecycle (human decisions)
  settlement: 'unpaid' | 'partially_paid' | 'paid',   -- cache, maintained by trigger
  appliedCents (int),                                 -- cache, maintained by trigger
  batchId → invoice_batches (nullable)                -- set when created under an idempotency key
```

- A provider bill (ConEd → me) and a roommate invoice (me → Sam) are the same thing.
- An invoice is a header plus **line items**; the category lives on the lines, not the invoice.
- No parent link: a roommate invoice may cover any number of provider bills, issued any time later.
- Invoices are immutable except `status` (and the trigger-maintained cache). Corrections are
  void + reissue; a reissue keeps the original `issuedAt` so it keeps its FIFO position.

### Idempotent bulk creation

`invoice_batches (id PK, fingerprint, createdAt)` holds client-supplied idempotency keys; `invoices.batch_id`
points at it. `createInvoices` and `invoiceRoommates` take an optional `batchId`:

- The batch row is the first statement of the same D1 batch that issues the invoices, so it exists exactly
  when they do, and the primary key makes a second create of the same id impossible (a concurrent loser
  catches the constraint error and returns the winner's invoices).
- `fingerprint` is a SHA-256 of the normalised request (kind `batch` or `split`, an omitted `issuedAt` counts as
  "now", not as a value). Same id and fingerprint: the existing invoices are returned (status 201 again) and nothing
  is written. Same id, different fingerprint: 409. Replay is checked before anything else is validated, so
  a replay still succeeds after the provider bills were voided.
- Without a `batchId` nothing changes: every call creates. `createInvoice` (single) already has its client `id`.
- The UI split flow generates a key per create payload and reuses it for retries; editing the drafts makes a new payload and so a new key.

### Invoice line items

```ts
invoice_line_items:
  id, invoiceId → invoices, position (int), description,
  category (expense category), amountCents (int, CHECK > 0)
  INDEX (invoice_id, position)
```

- `invoices.amount_cents` is a denormalised cache of `sum(line.amount_cents)`. Services compute the
  same sum before inserting (the invoice CHECK `amount_cents > 0` holds from the first statement) and
  the triggers below recompute it on every change to a line.
- Lines are frozen once the invoice is posted: a `BEFORE INSERT/UPDATE/DELETE` trigger aborts with
  `invoice is posted; void and reissue` when the invoice has an `invoiceIssued` ledger entry (also
  after a void). Within a create batch the lines are therefore inserted before the ledger post.
- Deleting (or moving away) the last line of an invoice aborts with
  `invoice must keep at least one line item`, instead of leaving a NULL amount to trip a constraint.

```sql
-- sum cache (the update trigger refreshes both OLD and NEW invoice)
CREATE TRIGGER invoice_line_items_sum_insert AFTER INSERT ON invoice_line_items
BEGIN
  UPDATE invoices
  SET amount_cents = (SELECT sum(amount_cents) FROM invoice_line_items WHERE invoice_id = NEW.invoice_id)
  WHERE id = NEW.invoice_id;
END;

-- immutability (UPDATE checks OLD and NEW invoice_id; DELETE checks OLD)
CREATE TRIGGER invoice_line_items_posted_no_insert BEFORE INSERT ON invoice_line_items
WHEN EXISTS (SELECT 1 FROM ledger_entries WHERE invoice_id = NEW.invoice_id AND kind = 'invoiceIssued')
BEGIN SELECT RAISE(ABORT, 'invoice is posted; void and reissue'); END;
```

Full set in `drizzle/0002_line_item_triggers.sql`.

### Lifecycle state machine (stored)

```
issued ──request──▶ requested
   │                   │
   └──────void─────────┴──▶ void
```

```ts
export const transitions = {
  issued: ['requested', 'void'],
  requested: ['void'],
  void: []
} as const satisfies Record<InvoiceStatus, readonly InvoiceStatus[]>
```

- A DAG: no backward edges. `requested` = Venmo request sent (invoices where payee = me).
- Paid-ness is **not** a lifecycle state; it is `settlement`, derived from payments (below).
- Transitions are logged in `invoice_transitions` (from, to, at, note).
- The UI shows only the actions legal from the current state, reading the same `transitions` table.

### Payments

```ts
payments: id (client-generated; idempotency key), payerId, payeeId, amountCents, paidAt,
          method: 'venmo' | 'zelle' | 'cash' | 'provider_portal', reference
```

- Payments move money between two parties; they do not belong to an invoice.
- Overpayment is allowed (it becomes credit).
- Payments are applied **FIFO** to the pair's non-void invoices, ordered by `(issued_at, id)`.
  Remaining balances are never stored; they are computed (and cached on the invoice by trigger).

## Double-entry ledger

The ledger is the source of truth for money. Invoices and payments are the documents; each one
posts balanced lines to the ledger.

### Accounts (deterministic ids — no lookups)

| Account                | Kind       | Meaning                                            |
| ---------------------- | ---------- | -------------------------------------------------- |
| `receivable:<partyId>` | receivable | what that roommate owes me (negative = credit)     |
| `payable:<partyId>`    | payable    | what I owe that provider                           |
| `cash`                 | cash       | money in/out of my Venmo/bank                      |
| `expense:<category>`   | expense    | my real cost, net of what I recover from roommates |

### `ledger_entries` (append-only)

```ts
ledger_entries:
  id, entryGroupId,                 -- lines of one posting share a group; a group sums to 0
  accountId → accounts,
  amountCents (signed: debit +, credit −),
  occurredAt,
  kind,                             -- entry registry key: 'invoiceIssued' | 'payment'
  reversesGroupId (nullable),       -- set on reversal postings
  partyLeg (bool),                  -- set by the framework: account is receivable:* / payable:*
  invoiceId → invoices (nullable),
  paymentId → payments (nullable),
  CHECK exactly one of invoiceId / paymentId
```

An invoice posts one party-leg line per line item, so there is no uniqueness constraint on the issue
posting; `post` is instead idempotent (inserts nothing if the source already has a non-reversal group
for that kind), mirroring `reverse`.

Indexes:

- `(account_id, occurred_at, amount_cents)` — covering; balances, as-of balances, statements.
- `(account_id, kind, invoice_id)` — trigger: invoices on an account, payment pool per account.

Rows are never updated or deleted. A void is a reversal posting.

### What each document posts

| Event             | Debit (+)                                                  | Credit (−)                |
| ----------------- | ---------------------------------------------------------- | ------------------------- |
| ConEd invoices me | `expense:<line.category>`, one transfer per line item      | `payable:coned`           |
| I pay ConEd       | `payable:coned`                                            | `cash`                    |
| I invoice Sam     | `receivable:sam`, one transfer per line item               | `expense:<line.category>` |
| Sam pays me       | `cash`                                                     | `receivable:sam`          |
| Void              | the original lines, signs flipped, `reverses_group_id` set |

Each expense account (`expense:utilities`, `expense:groceries`, …) therefore nets to my own share of
that category; `receivable:sam` going negative is Sam's credit. An invoice with lines in two
categories posts two transfers (four ledger lines) in one entry group; statements collapse the
party-account lines of a group back to one row per invoice.

### Balances

A balance is one index-only read:

```sql
SELECT coalesce(sum(amount_cents), 0) FROM ledger_entries WHERE account_id = :account
  [AND occurred_at <= :asOf];
```

A roommate's balance is 0 until I invoice them, rises when I do, and falls as payments are recorded.

### Declarative entry framework

Every money-moving document declares its ledger diff once, as a pure function of the document.
Generic part in `src/framework/ledger.ts` (never imports the app):

```ts
export type AccountId = string & { readonly __brand: 'AccountId' }
export interface Transfer {
  debit: AccountId
  credit: AccountId
  amountCents: number
}
export interface EntryDef<S, Src extends string = string> {
  source: Src // which FK column the lines link to
  transfers: (source: S) => readonly Transfer[]
}
export function defineEntry<S extends { id: string }, Src extends string>(d: EntryDef<S, Src>): EntryDef<S, Src>
export function expand(kind, def, source, occurredAt, sign = 1, reversesGroupId = null): LedgerLine[] // pure
export function diff(lines): Record<AccountId, number> // pure
export function makeLedger<Defs extends Record<string, EntryDef<never>>>(
  db,
  defs
): {
  post(kind, source, at?) // batch statement(s); idempotent (NOT EXISTS prior posting)
  reverse(kind, source, at?) // batch statement(s); idempotent (NOT EXISTS prior reversal)
}
```

- A transfer is one amount debited to one account and credited to another, so every declaration is
  balanced by construction. `expand` still asserts positive integer amounts.
- `EntryDef<never>` as the registry constraint keeps heterogenous source types without `any`;
  `SourceOf<Defs[K]>` recovers each one, so `post('payment', invoice)` is a compile error.
- Reversal re-derives the original lines from the (immutable) document and flips them — no ledger
  read-back.

App registry `src/ledger/entries.ts` — the complete list of what moves money:

```ts
export const entries = {
  invoiceIssued: defineEntry({
    source: 'invoice',
    // The document is the invoice WITH its line items; one transfer per line.
    transfers: (inv: InvoiceWithLines) =>
      inv.lineItems.map(line =>
        inv.payeeId === ME
          ? { debit: acct.receivable(inv.payerId), credit: acct.expense(line.category), amountCents: line.amountCents }
          : { debit: acct.expense(line.category), credit: acct.payable(inv.payeeId), amountCents: line.amountCents }
      )
  }),
  payment: defineEntry({
    source: 'payment',
    transfers: (p: Payment) =>
      p.payeeId === ME
        ? [{ debit: acct.cash, credit: acct.receivable(p.payerId), amountCents: p.amountCents }]
        : [{ debit: acct.payable(p.payeeId), credit: acct.cash, amountCents: p.amountCents }]
  })
}
export type EntryKind = keyof typeof entries // drives the `kind` column enum
```

Services post with one line, inside a D1 batch:

```ts
await db.batch([db.insert(payments).values(payment), ledger(db).post('payment', payment)])

// create: invoice (precomputed amount), its lines, then the ledger post (which freezes the lines)
await db.batch([
  db.insert(invoices).values(inv),
  db.insert(invoiceLineItems).values(lines),
  ...ledger(db).post('invoiceIssued', doc)
])

// void: load the invoice with its lines (reversal re-derives from them), status first so the
// trigger excludes the invoice, then the idempotent reversal
const [update] = await db.batch([
  db
    .update(invoices)
    .set({ status: 'void' })
    .where(and(eq(invoices.id, id), ne(invoices.status, 'void'))),
  ledger(db).reverse('invoiceIssued', docWithLines)
])
if (update.meta.changes === 0) throw new Conflict('Already void')
```

Each declaration gets a spec-style test of its diff:

```ts
expect(diff(expand('payment', entries.payment, p, NOW))).toEqual({ 'cash': 5000, 'receivable:sam': -5000 })
```

### Settlement cache (trigger)

`invoices.settlement` / `applied_cents` are a recomputed (never incremented) cache of FIFO
allocation, maintained by an `AFTER INSERT ON ledger_entries` trigger, written as a custom
Drizzle migration. The ledger — not the invoice — records which account an invoice touches.
An invoice has several party-leg rows (one per line), so the trigger fires several times per
invoice (idempotently) and sums prior invoices from `invoices`, never from joined ledger rows,
so a multi-line invoice is counted once.

```sql
CREATE TRIGGER ledger_recompute_settlement
AFTER INSERT ON ledger_entries
WHEN NEW.party_leg
BEGIN
  UPDATE invoices
  SET applied_cents = max(0, min(
        amount_cents,
        (SELECT abs(coalesce(sum(e.amount_cents), 0))
           FROM ledger_entries e
          WHERE e.account_id = NEW.account_id AND e.kind = 'payment')
        - coalesce((SELECT sum(o.amount_cents)
                      FROM invoices o
                     WHERE o.id IN (SELECT invoice_id FROM ledger_entries
                                     WHERE account_id = NEW.account_id
                                       AND kind = 'invoiceIssued' AND reverses_group_id IS NULL)
                       AND o.status != 'void'
                       AND (o.issued_at, o.id) < (invoices.issued_at, invoices.id)), 0)
      ))
  WHERE status != 'void'
    AND id IN (SELECT invoice_id FROM ledger_entries
                WHERE account_id = NEW.account_id
                  AND kind = 'invoiceIssued' AND reverses_group_id IS NULL);

  UPDATE invoices
  SET settlement = CASE WHEN applied_cents = amount_cents THEN 'paid'
                        WHEN applied_cents > 0 THEN 'partially_paid'
                        ELSE 'unpaid' END
  WHERE status != 'void'
    AND id IN (SELECT invoice_id FROM ledger_entries
                WHERE account_id = NEW.account_id
                  AND kind = 'invoiceIssued' AND reverses_group_id IS NULL);
END;
```

- SQLite triggers are row-level and allow no CTEs, hence correlated subqueries and row-value
  comparison instead of a window function.
- The trigger is the only FIFO implementation. Within a batch, write the invoice (or its status
  change) before its ledger lines so the trigger sees it.
- Settlement can move backwards if an invoice is backdated ahead of others; forbid backdating if
  that proves confusing.

### Combined invoice per roommate

For each selected provider bill, every line is split equally across the chosen roommates and me
with largest remainder (cents exact per line; the extra cents rotate across a bill's lines so a
bill's per-party totals differ by at most one cent). A roommate's invoice gets one line per bill
line, described `"<bill description> share"` (with `" (<line description>)"` for multi-line bills)
and keeping the line's category, followed by that roommate's `extraLines`
(`{ roommateId, description, category, amountCents }`). My share is not invoiced. The preview's
drafts are exactly what `createInvoices` accepts, so edit-then-save needs no server-side state.

## Correctness checks

- **Per-entry diff tests** — each `entries` declaration has a spec test (above).
- **Amount cache** — every invoice's `amount_cents` equals the sum of its line items (`assertConsistent`).
- **Balanced groups** — `SELECT entry_group_id FROM ledger_entries GROUP BY 1 HAVING sum(amount_cents) != 0` returns nothing.
- **Rebuild** — replay every invoice and payment through `entries` via `expand()`, compare to the
  stored ledger; independently compute FIFO in the test and compare to the cached `applied_cents`.
  Cases: exact payment, partial, overpayment/credit, voiding a middle invoice, lump payment across
  invoices.

## API

Endpoints are controller methods with Litestar-style signatures; TS 5 standard decorators
constrain the method type to the declared schemas (`src/framework/`, wrapping oRPC):

```ts
export class InvoiceController {
  @post('/invoices/{id}/void', { params: IdParam, returns: InvoiceDetail })
  async void(ctx: Ctx, { id }: IdParam): Promise<InvoiceDetail> { ... }
}
```

Schemas and types share a name (`export const X = z.object(...); export type X = z.infer<typeof X>`).
Every route sets `method` and `operationId` explicitly (Orval hook names; oRPC defaults to POST).

| Operation                     | Route                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `listParties` / `createParty` | `GET` / `POST /parties`                                                                                                                        |
| `listInvoices`                | `GET /invoices?direction=&status=&settlement=`                                                                                                 |
| `getInvoice`                  | `GET /invoices/{id}`                                                                                                                           |
| `createInvoice`               | `POST /invoices` — body takes `lineItems` (min 1), not amount/category                                                                         |
| `createInvoices`              | `POST /invoices/batch` — `{ invoices: [{ payerId, description, dueDate, lineItems }], batchId? }`, one D1 batch; `batchId` makes it idempotent |
| `previewSplit`                | `POST /invoices/split/preview` — same body as `invoiceRoommates`; returns drafts, writes nothing                                               |
| `invoiceRoommates`            | `POST /invoices/split` — preview + create in one call: one combined invoice per roommate; optional `batchId` (idempotent)                      |
| `requestInvoice`              | `POST /invoices/{id}/request`                                                                                                                  |
| `voidInvoice`                 | `POST /invoices/{id}/void`                                                                                                                     |
| `recordPayment`               | `POST /payments`                                                                                                                               |
| `listPayments`                | `GET /payments?partyId=`                                                                                                                       |
| `listBalances`                | `GET /balances`                                                                                                                                |
| `getStatement`                | `GET /accounts/{id}/statement?from=&to=`                                                                                                       |
| `getPosting`                  | `GET /postings/{entryGroupId}`                                                                                                                 |

Summaries carry `lineCount`; the detail adds `lineItems`. Statement lines carry a discriminated-union `source` (`invoice` | `payment`) and a party-perspective
signed amount with a running balance (window function over the account's index range).

## UI

- **Dashboard** — balances per roommate (0 until invoiced; credit shown when negative); invoices
  needing action.
- **Invoice roommates** — tick provider invoices, pick roommates, add optional manual lines (e.g.
  Groceries) per roommate. `previewSplit` returns one **draft** invoice per roommate whose lines the
  user edits freely (amounts, descriptions, add/remove); saving calls `createInvoices` with the edited
  drafts, creating all invoices in one D1 batch. `invoiceRoommates` is the no-edit shortcut doing
  preview + create server-side. Then the "Request on Venmo" deep link
  (`https://venmo.com/?txn=charge&recipients=<handle>&amount=<x>&note=<y>`; works, not an official API).
- **Statement** (per party) — date, description from source, signed amount, running balance; rows
  link to the posting and the source document.
- **Posting** — the entry group's lines as debit/credit with a balanced check.
- **Parties** — name, kind, Venmo handle.

## Out of scope (for now)

Invoice PDF uploads (R2), uneven splits, recurring bills, email reminders, explicit payment-to-invoice
pinning, payment reversals, extracting `src/framework/` into a package (wait for a second project).
