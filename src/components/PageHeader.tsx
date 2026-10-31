import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  crumb?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ title, crumb, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="bar-head">
      <div>
        {crumb !== undefined && <p className="crumb">{crumb}</p>}
        <h1>{title}</h1>
        {subtitle !== undefined && (
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions}
    </div>
  )
}
