import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import {
  getListBalancesSuspenseQueryOptions,
  getListInvoicesSuspenseQueryOptions,
  getListPartiesSuspenseQueryOptions,
  useListBalancesSuspense,
  useListInvoicesSuspense,
  useListPartiesSuspense,
  useRequestInvoice
} from '@/api-client/generated'
import type { ListBalances200RoommatesItem, ListInvoices200Item } from '@/api-client/generated/model'
import { Avatar } from '@/components/Avatar'
import { buttonClass } from '@/components/Button'
import { Card } from '@/components/Card'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Icon } from '@/components/Icon'
import { Money } from '@/components/Money'
import { PageHeader } from '@/components/PageHeader'
import { SettlementBadge } from '@/components/SettlementBadge'
import { StatusTag } from '@/components/StatusTag'
import { daysFromToday, formatDate, todayString } from '@/lib/dates'
import { INCOMING, OUTGOING, refreshLedger } from '@/lib/queries'

export const Route = createFileRoute('/')({
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([
      queryClient.query(getListBalancesSuspenseQueryOptions()),
      queryClient.query(getListInvoicesSuspenseQueryOptions(OUTGOING)),
      queryClient.query(getListInvoicesSuspenseQueryOptions(INCOMING)),
      queryClient.query(getListPartiesSuspenseQueryOptions())
    ])
  },
  component: Dashboard
})

const isOpen = (invoice: ListInvoices200Item): boolean => invoice.status !== 'void' && invoice.settlement !== 'paid'
const byDueDate = (a: ListInvoices200Item, b: ListInvoices200Item): number => a.dueDate.localeCompare(b.dueDate)

function Dashboard() {
  const { data: balancesResponse } = useListBalancesSuspense()
  const { data: outgoingResponse } = useListInvoicesSuspense(OUTGOING)
  const { data: incomingResponse } = useListInvoicesSuspense(INCOMING)
  const { data: partiesResponse } = useListPartiesSuspense()
  const balances = balancesResponse.data
  const names = new Map(partiesResponse.data.map(p => [p.id, p.name]))
  const outgoing = outgoingResponse.data
  const openOutgoing = outgoing.filter(isOpen).sort(byDueDate)
  const openIncoming = incomingResponse.data.filter(isOpen).sort(byDueDate)

  return (
    <>
      <PageHeader
        title="Balances"
        crumb={formatDate(todayString())}
        actions={
          <Link className={buttonClass('primary')} to="/split">
            + Invoice roommates
          </Link>
        }
      />
      <section className="grid3" aria-label="Balances">
        {balances.roommates.map(roommate => (
          <RoommateCard
            key={roommate.partyId}
            roommate={roommate}
            openInvoices={openOutgoing.filter(i => i.payerId === roommate.partyId)}
          />
        ))}
        {balances.roommates.length === 0 && <p className="empty">No roommates yet. Add one under Parties.</p>}
      </section>
      <section className="grid2">
        <Card title="Needs action">
          {openOutgoing.length === 0 && <p className="empty">Nothing waiting on a roommate.</p>}
          {openOutgoing.map(invoice => (
            <div className="na" key={invoice.id}>
              <span className="ic">
                <Icon name="invoice" />
              </span>
              <div>
                <Link className="t" to="/invoices/$invoiceId" params={{ invoiceId: invoice.id }}>
                  {invoice.description || 'Invoice'}
                </Link>
                <div className="s">
                  {names.get(invoice.payerId) ?? invoice.payerId} · {invoice.lineCount}{' '}
                  {invoice.lineCount === 1 ? 'line' : 'lines'} · due {formatDate(invoice.dueDate)}
                </div>
                <div className="chips">
                  <StatusTag status={invoice.status} />
                  <SettlementBadge
                    settlement={invoice.settlement}
                    appliedCents={invoice.appliedCents}
                    amountCents={invoice.amountCents}
                  />
                </div>
              </div>
              <div className="r">
                <span className="fig">
                  <Money cents={invoice.remainingCents} /> left
                </span>
                <Link
                  className={buttonClass('light', true)}
                  to="/invoices/$invoiceId"
                  params={{ invoiceId: invoice.id }}
                >
                  Open
                </Link>
              </div>
            </div>
          ))}
        </Card>
        <Card title="You owe providers">
          <div className="big fig">
            <Money cents={balances.totalIOweCents} />
          </div>
          {openIncoming.length === 0 && <p className="empty">No provider bills outstanding.</p>}
          {openIncoming.map(invoice => (
            <ProviderDue key={invoice.id} invoice={invoice} provider={names.get(invoice.payeeId) ?? invoice.payeeId} />
          ))}
          <div className="acts" style={{ marginTop: 14 }}>
            <Link className={buttonClass('light', true)} to="/bills/new">
              + Record provider bill
            </Link>
          </div>
        </Card>
      </section>
    </>
  )
}

function ProviderDue({ invoice, provider }: { invoice: ListInvoices200Item; provider: string }) {
  const days = daysFromToday(invoice.dueDate)
  const when = days < 0 ? `${-days} days overdue` : days === 0 ? 'today' : `in ${days} days`
  return (
    <div className="due">
      <div>
        <Link to="/invoices/$invoiceId" params={{ invoiceId: invoice.id }}>
          <b>{invoice.description || provider}</b>
        </Link>
        <span>
          {provider} · due {formatDate(invoice.dueDate)}
        </span>
      </div>
      <div style={{ textAlign: 'right' }}>
        <span className="when">{when}</span>
        <div className="fig" style={{ fontWeight: 700, marginTop: 4 }}>
          <Money cents={invoice.remainingCents} />
        </div>
      </div>
    </div>
  )
}

interface RoommateCardProps {
  roommate: ListBalances200RoommatesItem
  openInvoices: ListInvoices200Item[]
}

function RoommateCard({ roommate, openInvoices }: RoommateCardProps) {
  const queryClient = useQueryClient()
  const request = useRequestInvoice()
  const [error, setError] = useState<unknown>(null)
  const { balanceCents } = roommate
  const tone = balanceCents > 0 ? 'owed' : balanceCents < 0 ? 'credit' : 'zero'
  const count = openInvoices.length

  // The Venmo link opens natively; meanwhile each invoice still in `issued` moves to `requested`.
  const markRequested = async (): Promise<void> => {
    setError(null)
    try {
      for (const invoice of openInvoices.filter(i => i.status === 'issued')) {
        await request.mutateAsync({ id: invoice.id })
      }
      await refreshLedger(queryClient)
    } catch (e) {
      setError(e)
    }
  }

  return (
    <article className={`bcard ${tone}`}>
      <div className="who">
        <Avatar name={roommate.name} />
        {roommate.name}
      </div>
      <div className="v fig">
        <Money cents={balanceCents} />
      </div>
      <div className="cap">
        {tone === 'owed' && `Owes you · ${count} open ${count === 1 ? 'invoice' : 'invoices'}`}
        {tone === 'zero' && '✓ All paid up'}
        {tone === 'credit' && (
          <>
            <span className="sign">CREDIT</span>You owe {roommate.name}. Applied to the next invoice.
          </>
        )}
      </div>
      <div className="go acts">
        {roommate.venmoRequestUrl !== null && (
          <a
            className="btn"
            href={roommate.venmoRequestUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={request.isPending}
            onClick={() => {
              void markRequested()
            }}
          >
            Request on Venmo
          </a>
        )}
        <Link className="btn" to="/parties/$partyId/statement" params={{ partyId: roommate.partyId }} search={{}}>
          View statement
        </Link>
      </div>
      <ErrorAlert error={error} />
    </article>
  )
}
