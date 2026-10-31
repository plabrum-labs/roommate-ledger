import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, type SyntheticEvent } from 'react'

import { getListPartiesSuspenseQueryOptions, useCreateInvoice, useListPartiesSuspense } from '@/api-client/generated'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { ErrorAlert } from '@/components/ErrorAlert'
import { SelectField, TextField } from '@/components/Field'
import { LineItemsEditor } from '@/components/LineItemsEditor'
import { PageHeader } from '@/components/PageHeader'
import { addDays, dateToTimestamp, todayString } from '@/lib/dates'
import { blankLine, toLineItems, type LineDraft } from '@/lib/lines'
import { refreshLedger } from '@/lib/queries'

export const Route = createFileRoute('/bills/new')({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.query(getListPartiesSuspenseQueryOptions())
  },
  component: NewBill
})

function NewBill() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: partiesResponse } = useListPartiesSuspense()
  const providers = partiesResponse.data.filter(p => p.kind === 'provider')
  const create = useCreateInvoice()

  const [providerId, setProviderId] = useState<string>(providers[0]?.id ?? '')
  const [description, setDescription] = useState('')
  const [issued, setIssued] = useState<string>(todayString)
  const [due, setDue] = useState<string>(() => addDays(todayString(), 21))
  const [lines, setLines] = useState<LineDraft[]>(() => [{ ...blankLine('utilities'), manual: false }])
  const [touched, setTouched] = useState(false)

  const lineItems = toLineItems(lines)
  const problem =
    providerId === ''
      ? 'Pick a provider (add one under Parties first)'
      : lineItems === null
        ? 'Every line needs a description and an amount greater than $0.00'
        : issued === '' || due === ''
          ? 'Issued and due dates are required'
          : undefined

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    setTouched(true)
    if (problem !== undefined || lineItems === null) return
    create.mutate(
      {
        data: {
          payerId: 'me',
          payeeId: providerId,
          description: description.trim(),
          issuedAt: dateToTimestamp(issued),
          dueDate: due,
          lineItems
        }
      },
      {
        onSuccess: ({ data }) => {
          void refreshLedger(queryClient).then(() =>
            navigate({ to: '/invoices/$invoiceId', params: { invoiceId: data.id } })
          )
        }
      }
    )
  }

  return (
    <>
      <PageHeader
        title="Record provider bill"
        crumb={
          <>
            <Link to="/">Dashboard</Link> / Provider bill
          </>
        }
      />
      <form onSubmit={submit} noValidate className="stack">
        <Card>
          <div className="form" style={{ maxWidth: 'none' }}>
            <div className="row2">
              <SelectField
                label="Provider"
                value={providerId}
                onValueChange={setProviderId}
                options={providers.map(p => ({ value: p.id, label: p.name }))}
              />
              <TextField
                label="Description"
                value={description}
                onValueChange={setDescription}
                placeholder="ConEd electric Oct"
              />
            </div>
            <div className="row2">
              <TextField label="Issued" type="date" value={issued} onValueChange={setIssued} />
              <TextField label="Due" type="date" value={due} onValueChange={setDue} />
            </div>
          </div>
        </Card>
        <Card title="Line items">
          <LineItemsEditor label="Bill" lines={lines} onChange={setLines} totalLabel="Bill total" />
        </Card>
        <div className="acts">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Record bill'}
          </Button>
        </div>
        {touched && problem !== undefined && (
          <p className="alert" role="alert">
            {problem}
          </p>
        )}
        <ErrorAlert error={create.error} />
      </form>
    </>
  )
}
