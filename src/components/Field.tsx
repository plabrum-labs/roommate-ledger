import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

interface FieldShellProps {
  label: string
  error?: string | undefined
  children: ReactNode
}

function FieldShell({ label, error, children }: FieldShellProps) {
  return (
    <label className="field">
      {label}
      {children}
      {error !== undefined && <span className="err">{error}</span>}
    </label>
  )
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: string
  value: string
  onValueChange: (value: string) => void
  error?: string | undefined
}

export function TextField({ label, value, onValueChange, error, ...rest }: TextFieldProps) {
  return (
    <FieldShell label={label} error={error}>
      <input
        type="text"
        {...rest}
        value={value}
        aria-invalid={error !== undefined}
        onChange={e => {
          onValueChange(e.target.value)
        }}
      />
    </FieldShell>
  )
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  label: string
  value: string
  onValueChange: (value: string) => void
  options: readonly { value: string; label: string }[]
  error?: string | undefined
}

export function SelectField({ label, value, onValueChange, options, error, ...rest }: SelectFieldProps) {
  return (
    <FieldShell label={label} error={error}>
      <select
        {...rest}
        value={value}
        onChange={e => {
          onValueChange(e.target.value)
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  )
}
