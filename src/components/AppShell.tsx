import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { Icon } from './Icon'

function Logo() {
  return (
    <Link className="logo" to="/">
      <i>
        <b />
        <b />
      </i>
      Roommate Ledger
    </Link>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="top">
        <Logo />
      </div>
      <div className="app">
        <aside className="side">
          <Logo />
          <nav aria-label="Screens">
            <Link to="/" activeOptions={{ exact: true }}>
              <Icon name="home" />
              Dashboard
            </Link>
            <Link to="/split">
              <Icon name="split" />
              Invoice roommates
            </Link>
            <Link to="/payments/new">
              <Icon name="payment" />
              Record payment
            </Link>
            <Link to="/parties">
              <Icon name="parties" />
              Parties
            </Link>
          </nav>
          <div className="sp">All amounts in US dollars.</div>
        </aside>
        <main className="main">{children}</main>
      </div>
      <nav className="tabs" aria-label="Screens">
        <Link to="/" activeOptions={{ exact: true }}>
          <Icon name="home" />
          Home
        </Link>
        <Link to="/split">
          <Icon name="split" />
          Split
        </Link>
        <Link to="/payments/new">
          <Icon name="payment" />
          Payment
        </Link>
        <Link to="/parties">
          <Icon name="parties" />
          Parties
        </Link>
      </nav>
    </>
  )
}
