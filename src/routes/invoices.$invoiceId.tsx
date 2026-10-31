import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import {
  getGetInvoiceSuspenseQueryOptions,
  getGetStatementSuspenseQueryOptions,
  getListPartiesSuspenseQueryOptions,
  useGetInvoiceSuspense,
  useGetStatementSuspense,
  useListPartiesSuspense,
  useRequestInvoice,
  useVoidInvoice
} from '@/api-client/generated'
import type { GetInvoice200 } from '@/api-client/generated/model'
import { Button, buttonClass } from '@/components/Button'
import { Card } from '@/components/Card'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Money } from '@/components/Money'
import { PageHeader } from '@/components/PageHeader'
import { SettlementBadge, SettlementBar } from '@/components/SettlementBadge'
import { StatusTag } from '@/components/StatusTag'
import { formatDate, formatTimestamp } from '@/lib/dates'
import { refreshLedger } from '@/lib/queries'

/** The party-side ledger account an invoice posts to: what the roommate owes me, or what I owe the provider. */
function invoiceAccount(invoice: GetInvoice200): { accountId: string; partyId: string; incoming: boolean } {
  const incoming = invoice.payerId === 'me'
  return incoming
    ? { accountId: `payable:${invoice.payeeId}`, partyId: invoice.payeeId, incoming }
    : { accountId: `receivable:${invoice.payerId}`, partyId: invoice.payerId, incoming }
}

export const Route = createFileRoute('/invoices/$invoiceId')({
  loader: async ({ context: { queryClient }, params: { invoiceId } }) => {
    const [invoice] = await Promise.all([
      queryClient.query(getGetInvoiceSuspenseQueryOptions(invoiceId)),
      queryClient.query(getListPartiesSuspenseQueryOptions())
    ])
    // The invoice detail carries no posting id; the counterparty statement links invoice to posting.
    await queryClient.query(getGetStatementSuspenseQueryOptions(invoiceAccount(invoice.data).accountId))
  },
  component: InvoiceDetail
})

const FLOW = ['issued', 'requested', 'void'] as const

function InvoiceDetail() {
  const { invoiceId } = Route.useParams()
  const queryClient = useQueryClient()
  const { data: invoiceResponse } = useGetInvoiceSuspense(invoiceId)
  const { data: partiesResponse } = useListPartiesSuspense()
  const invoice = invoiceResponse.data
  const account = invoiceAccount(invoice)
  const { data: statementResponse } = useGetStatementSuspense(account.accountId)
  const request = useRequestInvoice()
  const void_ = useVoidInvoice()
  const [confirmVoid, setConfirmVoid] = useState(false)

  const names = new Map(partiesResponse.data.map(p => [p.id, p.name]))
  const nameOf = (id: string): string => (id === 'me' ? 'Me' : (names.get(id) ?? id))
  const party = nameOf(account.partyId)
  const issuePosting = statementResponse.data.lines.find(
    l => l.source.type === 'invoice' && l.source.invoiceId === invoice.id && !l.reversal
  )
  const voidPosting = statementResponse.data.lines.find(
    l => l.source.type === 'invoice' && l.source.invoiceId === invoice.id && l.reversal
  )

  const allowed = invoice.allowedTransitions
  const canRequest = allowed.includes('requested') && invoice.payeeId === 'me'
  const canVoid = allowed.includes('void')
  const currentIndex = FLOW.indexOf(invoice.status)

  const done = (): void => {
    setConfirmVoid(false)
    void refreshLedger(queryClient)
  }

  const hint =
    invoice.status === 'void'
      ? 'Void is final. Reissue a corrected invoice to replace it.'
      : invoice.status === 'requested'
        ? 'From Requested the only legal move is Void. Request is already done, so it is not offered.'
        : canRequest
          ? 'Issued invoices can be requested on Venmo or voided.'
          : 'You can void this invoice. Requests only apply to invoices you issue.'

  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link to="/parties/$partyId/statement" params={{ partyId: account.partyId }} search={{}}>
              {party}’s statement
            </Link>{' '}
            / Invoice
          </>
        }
        title={invoice.description || 'Invoice'}
        subtitle={`${nameOf(invoice.payerId)} to ${nameOf(invoice.payeeId)} · issued ${formatTimestamp(invoice.issuedAt)} · due ${formatDate(invoice.dueDate)}`}
      />
      <div className="hero">
        <Card title="Settlement">
          <div className="muted" style={{ fontSize: 13 }}>
            Worked out from payments
          </div>
          <div className="amtbig fig">
            <Money cents={invoice.remainingCents} />
            <span className="muted" style={{ fontSize: 18, letterSpacing: 0, fontWeight: 600 }}>
              {' '}
              left
            </span>
          </div>
          <SettlementBar
            settlement={invoice.settlement}
            appliedCents={invoice.appliedCents}
            amountCents={invoice.amountCents}
          />
          <div className="chips" style={{ marginTop: 12 }}>
            <SettlementBadge
              settlement={invoice.settlement}
              appliedCents={invoice.appliedCents}
              amountCents={invoice.amountCents}
            />
          </div>
          <dl className="rows">
            <dt>Invoice amount</dt>
            <dd className="fig">
              <Money cents={invoice.amountCents} />
            </dd>
            <dt>Applied</dt>
            <dd className="fig">
              <Money cents={invoice.appliedCents} />
            </dd>
            <dt className="rem">Remaining</dt>
            <dd className="rem fig">
              <Money cents={invoice.remainingCents} />
            </dd>
          </dl>
        </Card>
        <Card title="Status">
          <div className="muted" style={{ fontSize: 13 }}>
            Your decision. Moves forward only.
          </div>
          <div className="flow" style={{ marginTop: 16 }}>
            {FLOW.map((step, i) => {
              const state =
                step === invoice.status ? 'now' : allowed.includes(step) ? 'next' : i < currentIndex ? 'past' : ''
              return (
                <span className="node-row" key={step}>
                  {i > 0 && <span className="link" />}
                  <span className={`node ${state}`.trim()}>
                    {step[0]?.toUpperCase()}
                    {step.slice(1)}
                  </span>
                </span>
              )
            })}
          </div>
          <div className="chips">
            <StatusTag status={invoice.status} />
          </div>
          <p className="hint" style={{ marginTop: 14 }}>
            {hint}
          </p>
          <div className="acts">
            {canRequest && (
              <Button
                disabled={request.isPending}
                onClick={() => {
                  request.mutate({ id: invoice.id }, { onSuccess: done })
                }}
              >
                {request.isPending ? 'Requesting…' : 'Mark as requested'}
              </Button>
            )}
            {canVoid && !confirmVoid && (
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmVoid(true)
                }}
              >
                Void invoice
              </Button>
            )}
            {canVoid && confirmVoid && (
              <>
                <Button
                  variant="danger"
                  disabled={void_.isPending}
                  onClick={() => {
                    void_.mutate({ id: invoice.id }, { onSuccess: done })
                  }}
                >
                  {void_.isPending ? 'Voiding…' : 'Confirm void'}
                </Button>
                <Button
                  variant="light"
                  onClick={() => {
                    setConfirmVoid(false)
                  }}
                >
                  Cancel
                </Button>
              </>
            )}
            {issuePosting && (
              <Link
                className={buttonClass('light')}
                to="/postings/$entryGroupId"
                params={{ entryGroupId: issuePosting.entryGroupId }}
              >
                View posting
              </Link>
            )}
            {voidPosting && (
              <Link
                className={buttonClass('light')}
                to="/postings/$entryGroupId"
                params={{ entryGroupId: voidPosting.entryGroupId }}
              >
                View void posting
              </Link>
            )}
          </div>
          <ErrorAlert error={request.error ?? void_.error} />
        </Card>
      </div>
      <Card className="mt" title="Line items">
        <table className="lt">
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col">Category</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map(line => (
              <tr key={line.id}>
                <td>{line.description}</td>
                <td>
                  <span className="cat">{line.category}</span>
                </td>
                <td className="fig">
                  <Money cents={line.amountCents} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                Total · {invoice.lineItems.length} {invoice.lineItems.length === 1 ? 'line' : 'lines'}
              </td>
              <td className="fig">
                <Money cents={invoice.amountCents} />
              </td>
            </tr>
          </tfoot>
        </table>
        <p className="note">Posted invoices can’t be edited. Void and reissue to change a line.</p>
      </Card>
      <Card className="mt" title="History">
        <ul className="tl">
          <li>
            <b>Created as Issued</b>
            <span>
              {formatTimestamp(invoice.issuedAt)} · {invoice.lineItems.length}{' '}
              {invoice.lineItems.length === 1 ? 'line' : 'lines'}, <Money cents={invoice.amountCents} />
            </span>
          </li>
          {invoice.transitions.map(t => (
            <li key={`${t.at}-${t.toStatus}`}>
              <b>
                {t.fromStatus[0]?.toUpperCase()}
                {t.fromStatus.slice(1)} to {t.toStatus[0]?.toUpperCase()}
                {t.toStatus.slice(1)}
              </b>
              <span>
                {formatTimestamp(t.at)}
                {t.note ? ` · ${t.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
