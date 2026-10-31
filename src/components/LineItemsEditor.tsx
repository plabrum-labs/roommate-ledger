import { blankLine, DEFAULT_CATEGORIES, lineCents, totalCents, type LineDraft } from '@/lib/lines'
import { formatCents } from '@/lib/money'

import { Button } from './Button'
import { Icon } from './Icon'

interface LineItemsEditorProps {
  lines: readonly LineDraft[]
  onChange: (lines: LineDraft[]) => void
  /** Accessible name prefix, e.g. the roommate's name. */
  label: string
  totalLabel?: string
}

/** Editable invoice lines: description, category, dollar amount (parsed to cents only on submit), remove, add. */
export function LineItemsEditor({ lines, onChange, label, totalLabel = 'Invoice total' }: LineItemsEditorProps) {
  const update = (key: string, patch: Partial<LineDraft>): void => {
    onChange(lines.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }
  return (
    <>
      <div className="lh" aria-hidden="true">
        <span>Description</span>
        <span>Category</span>
        <span>Amount</span>
        <span />
      </div>
      {lines.map(line => {
        const categories = DEFAULT_CATEGORIES.includes(line.category)
          ? DEFAULT_CATEGORIES
          : [...DEFAULT_CATEGORIES, line.category]
        const amountBad = line.amountText.trim() !== '' && lineCents(line) === null
        return (
          <div className={`ln${line.manual ? ' manual' : ''}`} key={line.key}>
            <input
              className="d"
              type="text"
              value={line.description}
              aria-label={`${label} line description`}
              placeholder="Description"
              onChange={e => {
                update(line.key, { description: e.target.value })
              }}
            />
            <select
              className="c"
              value={line.category}
              aria-label={`${label} line category`}
              onChange={e => {
                update(line.key, { category: e.target.value })
              }}
            >
              {categories.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              className="amt"
              type="text"
              inputMode="decimal"
              value={line.amountText}
              placeholder="0.00"
              aria-label={`${label} line amount`}
              aria-invalid={amountBad}
              onChange={e => {
                update(line.key, { amountText: e.target.value })
              }}
            />
            <button
              className="rm"
              type="button"
              aria-label={`Remove ${label} line`}
              onClick={() => {
                onChange(lines.filter(l => l.key !== line.key))
              }}
            >
              <Icon name="close" />
            </button>
          </div>
        )
      })}
      <div className="addrow">
        <Button
          variant="light"
          small
          onClick={() => {
            onChange([...lines, blankLine()])
          }}
        >
          + Add line
        </Button>
        <div className="tot fig">
          <small>{totalLabel}</small>
          {formatCents(totalCents(lines))}
        </div>
      </div>
    </>
  )
}
