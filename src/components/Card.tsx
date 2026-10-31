import type { ReactNode } from 'react'

interface CardProps {
  title?: string
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article'
}

export function Card({ title, children, className, as: Tag = 'section' }: CardProps) {
  return (
    <Tag className={`card ${className ?? ''}`.trim()}>
      {title !== undefined && <h2>{title}</h2>}
      {children}
    </Tag>
  )
}
