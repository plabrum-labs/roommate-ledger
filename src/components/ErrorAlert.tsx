import { errorMessage } from '@/lib/errors'

export function ErrorAlert({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null
  return (
    <p className="alert" role="alert">
      {errorMessage(error)}
    </p>
  )
}
