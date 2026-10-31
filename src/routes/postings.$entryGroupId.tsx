import { createFileRoute, Link } from '@tanstack/react-router'

import {
  getGetPostingSuspenseQueryOptions,
  getListPartiesSuspenseQueryOptions,
  useGetPostingSuspense,
  useListPartiesSuspense
} from '@/api-client/generated'
import { buttonClass } from '@/components/Button'
import { Card } from '@/components/Card'
import { Money } from '@/components/Money'
import { PageHeader } from '@/components/PageHeader'
import { formatTimestamp } from '@/lib/dates'

export const Route = createFileRoute('/postings/$entryGroupId')({
  loader: async ({ context: { queryClient }, params: { entryGroupId } }) => {
    await Promise.all([
      queryClient.query(getGetPostingSuspenseQueryOptions(entryGroupId)),
      queryClient.query(getListPartiesSuspenseQueryOptions())
    ])
  },
  component: PostingPage
})

function titleCase(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

function PostingPage() {
  const { entryGroupId } = Route.useParams()
  const { data: postingResponse } = useGetPostingSuspense(entryGroupId)
  const { data: partiesResponse } = useListPartiesSuspense()
  const posting = postingResponse.data
  const names = new Map(partiesResponse.data.map(p => [p.id, p.name]))

  const accountName = (accountId: string): string => {
    const [kind = accountId, rest] = accountId.split(':')
    if (rest === undefined) return titleCase(kind)
    return `${titleCase(kind)}, ${kind === 'expense' ? rest : (names.get(rest) ?? rest)}`
  }

  const partyLeg = posting.lines.find(l => /^(receivable|payable):/.test(l.accountId))
  const partyId = partyLeg?.accountId.split(':')[1]

  const net = new Map<string, number>()
  for (const line of posting.lines) {
    net.set(line.accountId, (net.get(line.accountId) ?? 0) + line.debitCents - line.creditCents)
  }

  return (
    <>
      <PageHeader
        crumb={
          partyId === undefined ? (
            <Link to="/">Dashboard</Link>
          ) : (
            <>
              <Link to="/parties/$partyId/statement" params={{ partyId }} search={{}}>
                {names.get(partyId) ?? partyId}’s statement
              </Link>{' '}
              / Posting
            </>
          )
        }
        title={`Posting ${posting.entryGroupId}`}
        subtitle={`${posting.kind} · posted ${formatTimestamp(posting.occurredAt)} · ${posting.lines.length} lines${posting.reversesGroupId === null ? '' : ` · reverses ${posting.reversesGroupId}`}`}
        actions={
          posting.source.type === 'invoice' ? (
            <Link
              className={buttonClass('light')}
              to="/invoices/$invoiceId"
              params={{ invoiceId: posting.source.invoiceId }}
            >
              Source: Invoice
            </Link>
          ) : (
            <span className="muted">Source: payment ({posting.source.method})</span>
          )
        }
      />
      <div className="ptable" role="table" aria-label="Ledger lines">
        <div className="ph" role="row">
          <span>Account</span>
          <span>Debit</span>
          <span>Credit</span>
        </div>
        {posting.lines.map(line => (
          <div className="pl" role="row" key={line.entryId}>
            <div className="acct">
              <b>{accountName(line.accountId)}</b>
              <span>
                {line.accountId} · <span className="fig">{line.debitCents - line.creditCents}</span>
              </span>
            </div>
            {line.debitCents > 0 ? (
              <span className="a dr fig">
                <Money cents={line.debitCents} />
              </span>
            ) : (
              <span className="a empty">–</span>
            )}
            {line.creditCents > 0 ? (
              <span className="a crd fig">
                <Money cents={line.creditCents} />
              </span>
            ) : (
              <span className="a empty">–</span>
            )}
          </div>
        ))}
        <div className="pl pt" role="row">
          <div className="acct">
            <b>Totals</b>
          </div>
          <span className="a fig">
            <Money cents={posting.totalDebitCents} />
          </span>
          <span className="a fig">
            <Money cents={posting.totalCreditCents} />
          </span>
        </div>
      </div>
      <div className="foot">
        {posting.balanced ? (
          <span className="okbadge">
            {'✓'} Balanced{' '}
            <span className="fig" style={{ fontWeight: 600 }}>
              net <Money cents={posting.totalDebitCents - posting.totalCreditCents} />
            </span>
          </span>
        ) : (
          <span className="alert" role="alert">
            Unbalanced posting
          </span>
        )}
        {posting.source.type === 'invoice' && (
          <div className="acts" style={{ margin: 0 }}>
            <Link
              className={buttonClass('light')}
              to="/invoices/$invoiceId"
              params={{ invoiceId: posting.source.invoiceId }}
            >
              Open invoice
            </Link>
          </div>
        )}
      </div>
      <Card className="mt" title="Net by account">
        <dl className="rows">
          {[...net].map(([accountId, cents]) => (
            <div key={accountId} style={{ display: 'contents' }}>
              <dt>{accountId}</dt>
              <dd className="fig">
                <Money cents={cents} signed />
              </dd>
            </div>
          ))}
          <dt className="rem">Sum</dt>
          <dd className="rem fig">
            <Money cents={[...net.values()].reduce((a, b) => a + b, 0)} />
          </dd>
        </dl>
      </Card>
    </>
  )
}
