import { sql } from 'drizzle-orm'
import { getPlatformProxy } from 'wrangler'

import { createDb, type Db } from '../src/db/client'
import { parties } from '../src/db/schema'
import { listParties } from '../src/domain/queries'
import { createInvoice, createParty, createPayment, invoiceRoommates, requestInvoice } from '../src/domain/services'
import type { PaymentMethod } from '../src/domain/payment'

/**
 * Seeds the LOCAL D1 (miniflare state under .wrangler/) through the domain services, so every
 * invoice and payment posts its balanced ledger lines and the settlement trigger runs.
 * Run `npm run db:migrate:local` first. Pass `--reset` to wipe existing local data.
 */
const reset = process.argv.includes('--reset')

async function wipe(db: Db): Promise<void> {
  await db.batch([
    // Invoices go before their lines: the last-line guard only protects invoices that still exist.
    db.run(sql`PRAGMA defer_foreign_keys = on`),
    db.run(sql`DELETE FROM ledger_entries`),
    db.run(sql`DELETE FROM invoice_transitions`),
    db.run(sql`DELETE FROM invoices`),
    db.run(sql`DELETE FROM invoice_line_items`),
    db.run(sql`DELETE FROM payments`),
    db.run(sql`DELETE FROM accounts`),
    db.run(sql`DELETE FROM parties`)
  ])
}

const at = (date: string): string => `${date}T12:00:00Z`

interface Bill {
  id: string
  provider: 'coned' | 'fios'
  amountCents: number
  month: string
}

const coned = [14230, 12875, 15990, 17144]
const months = ['2026-07', '2026-08', '2026-09', '2026-10']
const bills: Bill[] = months.flatMap((month, i) => [
  { id: `coned-${month}`, provider: 'coned' as const, amountCents: coned[i] ?? 0, month },
  { id: `fios-${month}`, provider: 'fios' as const, amountCents: 7999, month }
])

async function seed(db: Db): Promise<void> {
  // The migrations already create the `me` party.
  if ((await listParties(db)).some(p => p.id !== 'me')) {
    if (!reset) {
      console.warn('Local database already has data; rerun with --reset to wipe and reseed.')
      return
    }
    await wipe(db)
  }

  await db.insert(parties).values({ id: 'me', name: 'Me', kind: 'me', venmoHandle: null }).onConflictDoNothing()
  for (const [id, name, venmoHandle] of [
    ['sam', 'Sam Rivera', 'sam-rivera'],
    ['alex', 'Alex Chen', 'alexchen'],
    ['jordan', 'Jordan Blake', 'jordan-blake']
  ] as const) {
    await createParty(db, { id, name, kind: 'roommate', venmoHandle })
  }
  await createParty(db, { id: 'coned', name: 'ConEd', kind: 'provider', venmoHandle: null })
  await createParty(db, { id: 'fios', name: 'Fios Internet', kind: 'provider', venmoHandle: null })

  for (const bill of bills) {
    await createInvoice(db, {
      id: bill.id,
      payerId: 'me',
      payeeId: bill.provider,
      description: `${bill.provider === 'coned' ? 'ConEd electric' : 'Fios internet'} ${bill.month}`,
      lineItems: [
        {
          description: bill.provider === 'coned' ? 'Electricity' : 'Internet service',
          category: bill.provider === 'coned' ? 'utilities' : 'internet',
          amountCents: bill.amountCents
        }
      ],
      issuedAt: at(`${bill.month}-03`),
      dueDate: `${bill.month}-24`
    })
  }

  // I pay the first three months' bills; October is still open.
  for (const bill of bills.filter(b => b.month !== '2026-10')) {
    await createPayment(
      db,
      {
        id: `pay-${bill.id}`,
        payerId: 'me',
        payeeId: bill.provider,
        amountCents: bill.amountCents,
        paidAt: at(`${bill.month}-20`),
        method: 'provider_portal',
        reference: null
      },
      at('2026-10-31')
    )
  }

  const roommateIds = ['sam', 'alex', 'jordan']
  // Invoicing happens late and in lumps: Jul+Aug together in September, Sep in October; Oct not yet.
  // Each roommate gets ONE combined invoice with a share line per bill (categories preserved) plus
  // any manual extras, e.g. Sam fronted groceries that I now recover from the others.
  const julAug = await invoiceRoommates(
    db,
    {
      providerInvoiceIds: bills.filter(b => b.month <= '2026-08').map(b => b.id),
      roommateIds,
      description: 'Utilities + internet, Jul-Aug',
      dueDate: '2026-09-30',
      extraLines: roommateIds.map(roommateId => ({
        roommateId,
        description: 'Groceries',
        category: 'groceries',
        amountCents: 1850
      }))
    },
    at('2026-09-05')
  )
  await invoiceRoommates(
    db,
    {
      providerInvoiceIds: bills.filter(b => b.month === '2026-09').map(b => b.id),
      roommateIds,
      description: 'Utilities + internet, Sep',
      dueDate: '2026-10-31'
    },
    at('2026-10-05')
  )

  for (const invoice of julAug.invoices) {
    if (invoice.payerId !== 'jordan') await requestInvoice(db, invoice.id, at('2026-09-06'))
  }

  const pay = async (
    id: string,
    payerId: string,
    amountCents: number,
    date: string,
    method: PaymentMethod
  ): Promise<void> => {
    await createPayment(
      db,
      { id, payerId, payeeId: 'me', amountCents, paidAt: at(date), method, reference: null },
      at(date)
    )
  }
  const share = (payerId: string): number => julAug.invoices.find(i => i.payerId === payerId)?.amountCents ?? 0
  await pay('pay-sam-1', 'sam', share('sam'), '2026-09-12', 'venmo') // Sam clears Jul-Aug
  await pay('pay-sam-2', 'sam', 2500, '2026-10-15', 'venmo') // ...and part of September
  await pay('pay-alex-1', 'alex', share('alex') + 10000, '2026-09-20', 'zelle') // Alex overpays: credit
  // Jordan has paid nothing.

  console.warn(
    'Seeded local D1: me, 3 roommates, ConEd + Fios, 8 bills, 2 invoicing rounds (one combined invoice per roommate, with line items), payments.'
  )
}

const proxy = await getPlatformProxy<Env>({ configPath: new URL('../wrangler.jsonc', import.meta.url).pathname })
try {
  await seed(createDb(proxy.env.DB))
} finally {
  await proxy.dispose()
}
