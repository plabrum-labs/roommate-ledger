import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, type SyntheticEvent } from 'react'

import { getListPartiesSuspenseQueryOptions, useCreateParty, useListPartiesSuspense } from '@/api-client/generated'
import type { ListParties200Item } from '@/api-client/generated/model'
import { Avatar } from '@/components/Avatar'
import { Button, buttonClass } from '@/components/Button'
import { Card } from '@/components/Card'
import { ErrorAlert } from '@/components/ErrorAlert'
import { SelectField, TextField } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import { refreshLedger } from '@/lib/queries'

export const Route = createFileRoute('/parties/')({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.query(getListPartiesSuspenseQueryOptions())
  },
  component: Parties
})

type Kind = 'roommate' | 'provider'

const KINDS = [
  { value: 'roommate', label: 'Roommate' },
  { value: 'provider', label: 'Provider' }
] as const

function isKind(value: string): value is Kind {
  return value === 'roommate' || value === 'provider'
}

function Parties() {
  const queryClient = useQueryClient()
  const { data: response } = useListPartiesSuspense()
  const create = useCreateParty()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Kind>('roommate')
  const [venmo, setVenmo] = useState('')
  const [touched, setTouched] = useState(false)

  const nameError = name.trim() === '' ? 'Name is required' : undefined

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    setTouched(true)
    if (nameError !== undefined) return
    const handle = venmo.trim().replace(/^@/, '')
    create.mutate(
      {
        data: { name: name.trim(), kind, venmoHandle: kind === 'roommate' && handle !== '' ? handle : null }
      },
      {
        onSuccess: () => {
          setName('')
          setVenmo('')
          setTouched(false)
          create.reset()
          void refreshLedger(queryClient)
        }
      }
    )
  }

  const group = (title: string, items: ListParties200Item[]) => (
    <Card title={title}>
      {items.length === 0 && <p className="empty">None yet.</p>}
      {items.map(p => (
        <div className="list-row" key={p.id}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Avatar name={p.name} />
            <div>
              <b>{p.name}</b>
              <div className="s">{p.venmoHandle ? `@${p.venmoHandle} on Venmo` : p.kind}</div>
            </div>
          </div>
          <Link
            className={buttonClass('light', true)}
            to="/parties/$partyId/statement"
            params={{ partyId: p.id }}
            search={{}}
          >
            Statement
          </Link>
        </div>
      ))}
    </Card>
  )

  const parties = response.data
  return (
    <>
      <PageHeader
        title="Parties"
        crumb={
          <>
            <Link to="/">Dashboard</Link> / Parties
          </>
        }
        actions={
          <Link className={buttonClass('light')} to="/bills/new">
            + Record provider bill
          </Link>
        }
      />
      <div className="grid2" style={{ marginTop: 0 }}>
        <div className="stack">
          {group(
            'Roommates',
            parties.filter(p => p.kind === 'roommate')
          )}
          {group(
            'Providers',
            parties.filter(p => p.kind === 'provider')
          )}
        </div>
        <Card title="Add a party">
          <form className="form" onSubmit={submit} noValidate>
            <TextField label="Name" value={name} onValueChange={setName} error={touched ? nameError : undefined} />
            <SelectField
              label="Kind"
              value={kind}
              onValueChange={v => {
                if (isKind(v)) setKind(v)
              }}
              options={KINDS}
            />
            {kind === 'roommate' && (
              <TextField
                label="Venmo handle (optional)"
                value={venmo}
                onValueChange={setVenmo}
                placeholder="sam-rivera"
              />
            )}
            <div className="acts">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Adding…' : 'Add party'}
              </Button>
            </div>
            <ErrorAlert error={create.error} />
          </form>
        </Card>
      </div>
    </>
  )
}
