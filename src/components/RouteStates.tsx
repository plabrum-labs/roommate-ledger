import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'

import { Button } from './Button'
import { Card } from './Card'
import { errorMessage } from '@/lib/errors'

export function RoutePending() {
  return (
    <p className="state" role="status">
      Loading…
    </p>
  )
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <Card title="Something went wrong">
      <p role="alert">{errorMessage(error)}</p>
      <div className="acts">
        <Button
          variant="light"
          onClick={() => {
            reset()
            void router.invalidate()
          }}
        >
          Try again
        </Button>
      </div>
    </Card>
  )
}

export function RouteNotFound() {
  return (
    <Card title="Not found">
      <p>That page or record does not exist.</p>
    </Card>
  )
}
