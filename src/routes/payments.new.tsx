import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, type SyntheticEvent } from 'react'
import { z } from 'zod'

import { getListPartiesSuspenseQueryOptions, useListPartiesSuspense, useRecordPayment } from '@/api-client/generated'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { ErrorAlert } from '@/components/ErrorAlert'
import { SelectField, TextField } from '@/components/Field'
import { PageHeader } from '@/components/PageHeader'
import { dateToTimestamp, todayString } from '@/lib/dates'
import { parseDollarsToCents } from '@/lib/money'
import { refreshLedger } from '@/lib/queries'

const PaymentSearch = z.object({ payerId: z.string().optional(), payeeId: z.string().optional() })

export const Route = createFileRoute('/payments/new')({
  validateSearch: PaymentSearch,
  loader: async ({ context: { queryClient } }) => {
    await queryClient.query(getListPartiesSuspenseQueryOptions())
  },
  component: NewPayment
})

const METHODS = [
  { value: 'venmo', label: 'Venmo' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'cash', label: 'Cash' },
  { value: 'provider_portal', label: 'Provider portal' }
] as const

type Method = (typeof METHODS)[number]['value']

function isMethod(value: string): value is Method {
  return METHODS.some(m => m.value === value)
}

function NewPayment() {
  const search = Route.useSearch()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: partiesResponse } = useListPartiesSuspense()
  const parties = partiesResponse.data
  const record = useRecordPayment()

  // Client-generated id: a retry after a network failure re-sends the same id and cannot double-post.
  const [paymentId] = useState<string>(() => crypto.randomUUID())
  const defaultPayer = search.payerId ?? parties.find(p => p.kind === 'roommate')?.id ?? 'me'
  const [payerId, setPayerId] = useState<string>(defaultPayer)
  const [payeeId, setPayeeId] = useState<string>(search.payeeId ?? 'me')
  const [amountText, setAmountText] = useState('')
  const [method, setMethod] = useState<Method>('venmo')
  const [reference, setReference] = useState('')
  const [paidAt, setPaidAt] = useState<string>(todayString)
  const [touched, setTouched] = useState(false)

  const options = parties.map(p => ({ value: p.id, label: p.id === 'me' ? 'Me' : p.name }))
  const cents = parseDollarsToCents(amountText)
  const amountError = cents === null || cents <= 0 ? 'Enter an amount greater than $0.00 (e.g. 25.50)' : undefined
  const partyError = payerId === payeeId ? 'Payer and payee must differ' : undefined
  const invalid = amountError !== undefined || partyError !== undefined || paidAt === ''

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    setTouched(true)
    if (invalid || cents === null) return
    record.mutate(
      {
        data: {
          id: paymentId,
          payerId,
          payeeId,
          amountCents: cents,
          method,
          reference: reference.trim() === '' ? null : reference.trim(),
          paidAt: dateToTimestamp(paidAt)
        }
      },
      {
        onSuccess: () => {
          const other = payerId === 'me' ? payeeId : payerId
          void refreshLedger(queryClient).then(() =>
            navigate({ to: '/parties/$partyId/statement', params: { partyId: other }, search: {} })
          )
        }
      }
    )
  }

  return (
    <>
      <PageHeader
        title="Record payment"
        crumb={
          <>
            <Link to="/">Dashboard</Link> / Record payment
          </>
        }
      />
      <Card>
        <form className="form" onSubmit={submit} noValidate>
          <div className="row2">
            <SelectField label="Payer (who paid)" value={payerId} onValueChange={setPayerId} options={options} />
            <SelectField
              label="Payee (who received)"
              value={payeeId}
              onValueChange={setPayeeId}
              options={options}
              error={touched ? partyError : undefined}
            />
          </div>
          <div className="row2">
            <TextField
              label="Amount (USD)"
              inputMode="decimal"
              placeholder="0.00"
              value={amountText}
              onValueChange={setAmountText}
              error={touched ? amountError : undefined}
            />
            <TextField label="Paid on" type="date" value={paidAt} onValueChange={setPaidAt} />
          </div>
          <div className="row2">
            <SelectField
              label="Method"
              value={method}
              onValueChange={v => {
                if (isMethod(v)) setMethod(v)
              }}
              options={METHODS}
            />
            <TextField label="Reference (optional)" value={reference} onValueChange={setReference} />
          </div>
          <div className="acts">
            <Button type="submit" disabled={record.isPending}>
              {record.isPending ? 'Recording…' : 'Record payment'}
            </Button>
          </div>
          <ErrorAlert error={record.error} />
        </form>
      </Card>
    </>
  )
}
