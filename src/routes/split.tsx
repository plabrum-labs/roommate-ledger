import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import {
  getListInvoicesSuspenseQueryOptions,
  getListPartiesSuspenseQueryOptions,
  useCreateInvoices,
  useListInvoicesSuspense,
  useListPartiesSuspense,
  usePreviewSplit
} from '@/api-client/generated'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { ErrorAlert } from '@/components/ErrorAlert'
import { LineItemsEditor } from '@/components/LineItemsEditor'
import { Money } from '@/components/Money'
import { PageHeader } from '@/components/PageHeader'
import { addDays, formatDate, formatTimestamp, todayString } from '@/lib/dates'
import { lineFromCents, toLineItems, totalCents, type LineDraft } from '@/lib/lines'
import { formatCents } from '@/lib/money'
import { INCOMING, refreshLedger } from '@/lib/queries'

export const Route = createFileRoute('/split')({
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([
      queryClient.query(getListInvoicesSuspenseQueryOptions(INCOMING)),
      queryClient.query(getListPartiesSuspenseQueryOptions())
    ])
  },
  component: Split
})

interface DraftState {
  payerId: string
  issuedAt: string
  lines: LineDraft[]
}

function Split() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: billsResponse } = useListInvoicesSuspense(INCOMING)
  const { data: partiesResponse } = useListPartiesSuspense()
  const preview = usePreviewSplit()
  const create = useCreateInvoices()

  const bills = billsResponse.data.filter(i => i.status !== 'void')
  const roommates = partiesResponse.data.filter(p => p.kind === 'roommate')
  const providerNames = new Map(partiesResponse.data.map(p => [p.id, p.name]))

  const [billIds, setBillIds] = useState<string[]>([])
  const [roommateIds, setRoommateIds] = useState<string[]>([])
  const [dueDate, setDueDate] = useState<string>(() => addDays(todayString(), 14))
  const [descriptionOverride, setDescriptionOverride] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<DraftState[]>([])

  const rebuild = (nextBills: string[], nextRoommates: string[]): void => {
    setBillIds(nextBills)
    setRoommateIds(nextRoommates)
    create.reset()
    if (nextBills.length === 0 || nextRoommates.length === 0) {
      preview.reset()
      setDrafts([])
      return
    }
    preview.mutate(
      { data: { providerInvoiceIds: nextBills, roommateIds: nextRoommates, dueDate } },
      {
        onSuccess: ({ data }) => {
          setDescriptionOverride(null)
          setDrafts(
            data.drafts.map(d => ({
              payerId: d.payerId,
              issuedAt: d.issuedAt,
              lines: d.lineItems.map(l => lineFromCents(l))
            }))
          )
        }
      }
    )
  }

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter(x => x !== id) : [...list, id]

  const selectedTotal = bills.filter(b => billIds.includes(b.id)).reduce((sum, b) => sum + b.amountCents, 0)
  const previewData = preview.data?.data
  const description = descriptionOverride ?? previewData?.drafts[0]?.description ?? ''
  const draftTotals = drafts.map(d => totalCents(d.lines))
  const grandTotal = draftTotals.reduce((a, b) => a + b, 0)
  const nameOf = (id: string): string => providerNames.get(id) ?? id
  const lineItemsPerDraft = drafts.map(d => toLineItems(d.lines))
  const canCreate =
    drafts.length > 0 && lineItemsPerDraft.every(items => items !== null) && dueDate !== '' && !create.isPending

  const submit = (): void => {
    const invoices = drafts.flatMap((d, i) => {
      const lineItems = lineItemsPerDraft[i]
      return lineItems ? [{ payerId: d.payerId, description, dueDate, issuedAt: d.issuedAt, lineItems }] : []
    })
    create.mutate(
      { data: { invoices } },
      {
        onSuccess: () => {
          void refreshLedger(queryClient).then(() => navigate({ to: '/' }))
        }
      }
    )
  }

  return (
    <>
      <PageHeader
        title="Invoice roommates"
        crumb={
          <>
            <Link to="/">Dashboard</Link> / Invoice roommates
          </>
        }
      />
      <p className="hint" style={{ marginTop: -10 }}>
        One combined invoice per roommate.
      </p>
      <div className="stack">
        <Card>
          <div className="step">
            <span className="n">1</span>
            <h2>Provider bills</h2>
          </div>
          <p className="hint">Tick the bills to split.</p>
          {bills.length === 0 && (
            <p className="empty">
              No provider bills yet. <Link to="/bills/new">Record one</Link>.
            </p>
          )}
          <div className="tiles">
            {bills.map(bill => (
              <label className="tile" key={bill.id}>
                <input
                  type="checkbox"
                  checked={billIds.includes(bill.id)}
                  onChange={() => {
                    rebuild(toggle(billIds, bill.id), roommateIds)
                  }}
                />
                <span className="nm">
                  {bill.description || nameOf(bill.payeeId)}
                  <span>
                    billed {formatTimestamp(bill.issuedAt)}, due {formatDate(bill.dueDate)}
                  </span>
                </span>
                <Money cents={bill.amountCents} />
              </label>
            ))}
          </div>
        </Card>

        <Card>
          <div className="step">
            <span className="n">2</span>
            <h2>Roommates</h2>
          </div>
          <p className="hint">Everyone ticked shares the cost. You always take a share but are not invoiced.</p>
          <div className="who">
            {roommates.map(r => (
              <label className="chip" key={r.id}>
                <input
                  type="checkbox"
                  checked={roommateIds.includes(r.id)}
                  onChange={() => {
                    rebuild(billIds, toggle(roommateIds, r.id))
                  }}
                />
                <Avatar name={r.name} />
                {r.name}
              </label>
            ))}
            <span className="chip me">
              <Avatar name="You" />
              You (share kept, not invoiced)
            </span>
          </div>
          {billIds.length > 0 && roommateIds.length > 0 && (
            <p className="sumline">
              <b className="fig">{formatCents(selectedTotal)}</b> split {roommateIds.length + 1} ways, exact to the cent
              (extra cents go to the first names in each bill).
              {previewData && (
                <>
                  {' '}
                  Your share: <b className="fig">{formatCents(previewData.myShareCents)}</b>.
                </>
              )}
            </p>
          )}
          <ErrorAlert error={preview.error} />
        </Card>

        {drafts.length > 0 && (
          <>
            <Card>
              <div className="step">
                <span className="n">3</span>
                <h2>Review draft invoices</h2>
              </div>
              <p className="hint">
                One prefilled line per bill. Edit, remove or add lines before creating. Changing the ticks above
                rebuilds the drafts.
              </p>
              <div className="fields">
                <label>
                  Description
                  <input
                    type="text"
                    value={description}
                    onChange={e => {
                      setDescriptionOverride(e.target.value)
                    }}
                  />
                </label>
                <label>
                  Due date
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => {
                      setDueDate(e.target.value)
                    }}
                  />
                </label>
              </div>
            </Card>
            <div className="dstack">
              {drafts.map((draft, index) => (
                <article
                  className="draft"
                  key={draft.payerId}
                  aria-label={`Draft invoice for ${nameOf(draft.payerId)}`}
                >
                  <header>
                    <h3>
                      <Avatar name={nameOf(draft.payerId)} />
                      {nameOf(draft.payerId)}
                      <small>
                        {draft.lines.length} {draft.lines.length === 1 ? 'line' : 'lines'}
                      </small>
                    </h3>
                    <span className="tag issued">Draft</span>
                  </header>
                  <LineItemsEditor
                    label={nameOf(draft.payerId)}
                    lines={draft.lines}
                    onChange={lines => {
                      setDrafts(drafts.map((d, i) => (i === index ? { ...d, lines } : d)))
                    }}
                  />
                </article>
              ))}
            </div>
            <div className="cta">
              <div>
                <b className="fig">{formatCents(grandTotal)}</b> to roommates
                <small className="fig">
                  {draftTotals.map(c => formatCents(c)).join(' + ')} · due {dueDate === '' ? '—' : formatDate(dueDate)}
                </small>
              </div>
              <Button disabled={!canCreate} onClick={submit}>
                {create.isPending
                  ? 'Creating…'
                  : `Create ${drafts.length} ${drafts.length === 1 ? 'invoice' : 'invoices'}`}
              </Button>
            </div>
            <ErrorAlert error={create.error} />
          </>
        )}
      </div>
    </>
  )
}
