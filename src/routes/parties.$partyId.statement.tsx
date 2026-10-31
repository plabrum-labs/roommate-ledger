import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'

import {
  getGetStatementSuspenseQueryOptions,
  getListBalancesSuspenseQueryOptions,
  getListPartiesSuspenseQueryOptions,
  useGetStatementSuspense,
  useListBalancesSuspense,
  useListPartiesSuspense
} from '@/api-client/generated'
import type { GetStatement200LinesItem, GetStatementParams, ListParties200Item } from '@/api-client/generated/model'
import { buttonClass } from '@/components/Button'
import { Icon } from '@/components/Icon'
import { Money } from '@/components/Money'
import { PageHeader } from '@/components/PageHeader'
import { StatusTag } from '@/components/StatusTag'
import { addDays, endOfDay, formatTimestamp, monthLabel, startOfDay, todayString } from '@/lib/dates'

const StatementSearch = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional()
})
type StatementSearch = z.infer<typeof StatementSearch>

function statementAccount(party: ListParties200Item): string {
  return party.kind === 'provider' ? `payable:${party.id}` : `receivable:${party.id}`
}

function statementParams(search: StatementSearch): GetStatementParams {
  return {
    ...(search.from === undefined ? {} : { from: startOfDay(search.from) }),
    ...(search.to === undefined ? {} : { to: endOfDay(search.to) })
  }
}

export const Route = createFileRoute('/parties/$partyId/statement')({
  validateSearch: StatementSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, params: { partyId }, deps }) => {
    const parties = await queryClient.query(getListPartiesSuspenseQueryOptions())
    const party = parties.data.find(p => p.id === partyId)
    if (!party || party.kind === 'me') throw new Error('Party not found')
    await Promise.all([
      queryClient.query(getGetStatementSuspenseQueryOptions(statementAccount(party), statementParams(deps))),
      queryClient.query(getListBalancesSuspenseQueryOptions())
    ])
  },
  component: StatementPage
})

function StatementPage() {
  const { partyId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { data: partiesResponse } = useListPartiesSuspense()
  const { data: balancesResponse } = useListBalancesSuspense()
  const party = partiesResponse.data.find(p => p.id === partyId)
  if (!party) throw new Error('Party not found')
  const { data: statementResponse } = useGetStatementSuspense(statementAccount(party), statementParams(search))
  const statement = statementResponse.data
  const roommate = balancesResponse.data.roommates.find(r => r.partyId === partyId)
  const provider = party.kind === 'provider'

  const [first] = statement.lines
  const openingCents = first ? first.balanceCents - first.amountCents : statement.closingBalanceCents
  const today = todayString()
  const presets: { label: string; search: StatementSearch; active: boolean }[] = [
    {
      label: '30 days',
      search: { from: addDays(today, -30) },
      active: search.from === addDays(today, -30) && search.to === undefined
    },
    {
      label: 'This year',
      search: { from: `${today.slice(0, 4)}-01-01` },
      active: search.from === `${today.slice(0, 4)}-01-01` && search.to === undefined
    },
    { label: 'All', search: {}, active: search.from === undefined && search.to === undefined }
  ]
  const custom = !presets.some(p => p.active)

  const months: { month: string; lines: GetStatement200LinesItem[] }[] = []
  for (const line of statement.lines) {
    const month = monthLabel(line.occurredAt)
    const last = months[months.length - 1]
    if (last?.month === month) last.lines.push(line)
    else months.push({ month, lines: [line] })
  }

  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link to="/">Dashboard</Link> / Statements
          </>
        }
        title={`${party.name}’s statement`}
        actions={
          <div className="acts" style={{ marginTop: 0 }}>
            {roommate?.venmoRequestUrl && (
              <a className="btn blue" href={roommate.venmoRequestUrl} target="_blank" rel="noopener noreferrer">
                Request on Venmo
              </a>
            )}
            <Link
              className={buttonClass('light')}
              to="/payments/new"
              search={provider ? { payerId: 'me', payeeId: party.id } : { payerId: party.id, payeeId: 'me' }}
            >
              Record payment
            </Link>
          </div>
        }
      />
      <div className="sum">
        <div className="card">
          <div className="k">Opening{search.from ? ` · ${formatTimestamp(startOfDay(search.from))}` : ''}</div>
          <div className="v fig">
            <Money cents={openingCents} />
          </div>
        </div>
        <div className="card hot">
          <div className="k">Closing{search.to ? ` · ${formatTimestamp(endOfDay(search.to))}` : ''}</div>
          <div className="v fig">
            <Money cents={statement.closingBalanceCents} />
          </div>
        </div>
        <div className="card">
          <div className="k">Sign guide</div>
          <div style={{ fontSize: 13 }}>
            <b className="fig pos">+</b> {provider ? 'You owe more' : `${party.name} owes more`}
            <br />
            <b className="fig neg">−</b> {provider ? 'You owe less' : `${party.name} owes less`}
          </div>
        </div>
      </div>
      <div className="filter">
        <div className="seg" role="group" aria-label="Range">
          {presets.map(p => (
            <Link key={p.label} to="." search={p.search} data-active={p.active}>
              {p.label}
            </Link>
          ))}
          <Link to="." search={search} data-active={custom}>
            Custom
          </Link>
        </div>
        <div className="dates">
          <input
            type="date"
            aria-label="From"
            value={search.from ?? ''}
            onChange={e => {
              void navigate({ search: { ...search, from: e.target.value === '' ? undefined : e.target.value } })
            }}
          />
          <span className="muted">to</span>
          <input
            type="date"
            aria-label="To"
            value={search.to ?? ''}
            onChange={e => {
              void navigate({ search: { ...search, to: e.target.value === '' ? undefined : e.target.value } })
            }}
          />
        </div>
      </div>
      <div className="edge open">
        <span>Opening balance</span>
        <Money cents={openingCents} />
      </div>
      {statement.lines.length === 0 && <p className="empty">No activity in this range.</p>}
      {months.map(({ month, lines }) => (
        <div key={month}>
          <div className="month">{month}</div>
          {lines.map(line => (
            <StatementRow key={line.entryGroupId} line={line} />
          ))}
        </div>
      ))}
      <div className="edge close" style={{ marginTop: 12 }}>
        <span>Closing balance</span>
        <Money cents={statement.closingBalanceCents} />
      </div>
    </>
  )
}

function StatementRow({ line }: { line: GetStatement200LinesItem }) {
  const { source } = line
  const gone = source.type === 'invoice' && source.status === 'void' && !line.reversal
  const icon = source.type === 'payment' ? 'payment' : line.reversal ? 'voidmark' : 'invoice'
  const iconClass = source.type === 'payment' ? ' pay' : line.reversal ? ' void' : ''
  return (
    <div className={`ent${gone ? ' gone' : ''}`}>
      <span className={`ic${iconClass}`}>
        <Icon name={icon} />
      </span>
      <div>
        {source.type === 'invoice' ? (
          <Link className="t" to="/invoices/$invoiceId" params={{ invoiceId: source.invoiceId }}>
            {line.description}
          </Link>
        ) : (
          <span className="t">
            Payment · {source.method}
            {source.reference ? ` ${source.reference}` : ''}
          </span>
        )}
        <div className="s">
          {formatTimestamp(line.occurredAt)} ·{' '}
          <Link className="plink" to="/postings/$entryGroupId" params={{ entryGroupId: line.entryGroupId }}>
            Posting
          </Link>
        </div>
        {source.type === 'invoice' && !line.reversal && (
          <div className="chips">
            <StatusTag status={source.status} />
          </div>
        )}
      </div>
      <div className="am">
        <b className={`fig ${line.amountCents > 0 ? 'pos' : 'neg'}`}>
          <Money cents={line.amountCents} signed />
        </b>
        <span className="fig">
          bal <Money cents={line.balanceCents} />
        </span>
      </div>
    </div>
  )
}
