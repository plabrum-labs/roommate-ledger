import { makeLedger } from '@/framework/ledger'
import type { Db } from '@/db/client'

import { accountKind, isPartyAccount } from './accounts'
import { entries } from './entries'

export { acct, ME, parseAccountId, accountKind } from './accounts'
export { entries, type EntryKind } from './entries'

export function ledger(db: Pick<Db, 'insert'>) {
  return makeLedger(db, entries, {
    accountKind,
    isPartyAccount,
    sourceColumns: { invoice: 'invoice_id', payment: 'payment_id' }
  })
}
