import type { AccountId } from '@/framework/ledger'

export const ME = 'me'

const id = (s: string): AccountId => s as AccountId

export const acct = {
  cash: id('cash'),
  expense: (category: string): AccountId => id(`expense:${category}`),
  receivable: (partyId: string): AccountId => id(`receivable:${partyId}`),
  payable: (partyId: string): AccountId => id(`payable:${partyId}`)
}

export type AccountKind = 'receivable' | 'payable' | 'cash' | 'expense'

export function accountKind(accountId: AccountId): AccountKind {
  if (accountId === acct.cash) return 'cash'
  if (accountId.startsWith('expense:')) return 'expense'
  if (accountId.startsWith('receivable:')) return 'receivable'
  if (accountId.startsWith('payable:')) return 'payable'
  throw new Error(`Unknown account: ${accountId}`)
}

export function isPartyAccount(accountId: AccountId): boolean {
  const kind = accountKind(accountId)
  return kind === 'receivable' || kind === 'payable'
}

/** Validates an externally supplied account id (e.g. a URL segment). */
export function parseAccountId(raw: string): AccountId | null {
  return raw === 'cash' || /^(expense|receivable|payable):.+/.test(raw) ? id(raw) : null
}
