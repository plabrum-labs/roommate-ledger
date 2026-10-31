import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'light' | 'danger'

/** Class names for a button-looking element; use with `<Link>` or `<a>` as well as `<button>`. */
export function buttonClass(variant: ButtonVariant = 'primary', small = false): string {
  const v = variant === 'light' ? ' light' : variant === 'danger' ? ' rose' : ' blue'
  return `btn${v}${small ? ' sm' : ''}`
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  small?: boolean
}

export function Button({ variant = 'primary', small = false, type = 'button', className, ...rest }: ButtonProps) {
  return <button type={type} className={`${buttonClass(variant, small)} ${className ?? ''}`.trim()} {...rest} />
}
