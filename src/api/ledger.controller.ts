import { balance, getParty, listParties, partyBalances, posting, statement } from '@/domain/queries'
import { NotFound } from '@/domain/errors'
import { venmoRequestUrl } from '@/domain/venmo'
import { accountKind, parseAccountId } from '@/ledger'

import type { Ctx } from './context'
import { presentPosting, presentStatementLine } from './present'
import { get } from './routes'
import { Balances, Posting, PostingParam, Statement, StatementQuery } from './schemas'

const tags = ['ledger']

export class LedgerController {
  @get('/balances', { operationId: 'listBalances', returns: Balances, tags })
  async balances(ctx: Ctx): Promise<Balances> {
    const [parties, { receivables, payables }] = await Promise.all([listParties(ctx.db), partyBalances(ctx.db)])
    const roommates = parties
      .filter(p => p.kind === 'roommate')
      .map(p => {
        const balanceCents = receivables.get(p.id) ?? 0
        return {
          partyId: p.id,
          name: p.name,
          venmoHandle: p.venmoHandle,
          balanceCents,
          venmoRequestUrl: venmoRequestUrl({ handle: p.venmoHandle, amountCents: balanceCents, note: 'Utilities' })
        }
      })
    const providers = parties
      .filter(p => p.kind === 'provider')
      .map(p => ({ partyId: p.id, name: p.name, owedCents: payables.get(p.id) ?? 0 }))
    return {
      roommates,
      providers,
      totalOwedToMeCents: roommates.reduce((sum, r) => sum + Math.max(r.balanceCents, 0), 0),
      totalIOweCents: providers.reduce((sum, p) => sum + Math.max(p.owedCents, 0), 0)
    }
  }

  @get('/accounts/{id}/statement', {
    operationId: 'getStatement',
    params: StatementQuery,
    returns: Statement,
    tags
  })
  async statement(ctx: Ctx, { id, from, to }: StatementQuery): Promise<Statement> {
    const accountId = parseAccountId(id)
    if (!accountId) throw new NotFound(`Account ${id} not found`)
    const kind = accountKind(accountId)
    const partyId = kind === 'receivable' || kind === 'payable' ? accountId.slice(accountId.indexOf(':') + 1) : null
    const party = partyId === null ? undefined : await getParty(ctx.db, partyId)
    if (partyId !== null && !party) throw new NotFound(`Party ${partyId} not found`)
    const sign = kind === 'payable' ? -1 : 1
    const [lines, closing] = await Promise.all([
      statement(ctx.db, accountId, { from, to }),
      balance(ctx.db, accountId, to)
    ])
    return {
      accountId,
      partyId,
      partyName: party?.name ?? null,
      lines: lines.map(l => presentStatementLine(l, sign)),
      closingBalanceCents: sign * closing
    }
  }

  @get('/postings/{entryGroupId}', { operationId: 'getPosting', params: PostingParam, returns: Posting, tags })
  async posting(ctx: Ctx, { entryGroupId }: PostingParam): Promise<Posting> {
    const [first, ...rest] = await posting(ctx.db, entryGroupId)
    if (!first) throw new NotFound(`Posting ${entryGroupId} not found`)
    return presentPosting(entryGroupId, [first, ...rest])
  }
}
