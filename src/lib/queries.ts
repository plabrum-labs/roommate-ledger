import type { QueryClient } from '@tanstack/react-query'

/** After any mutation: mark every cached query stale and refetch it, so balances, invoices, statements and postings agree. */
export async function refreshLedger(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ refetchType: 'all' })
}

export const OUTGOING = { direction: 'outgoing' } as const
export const INCOMING = { direction: 'incoming' } as const
