// Mirrors soren-em-wedding src/lib/host-routing.ts (the MCP-host part); extract on third use.
export const MAIN_HOSTNAME = 'roommate-ledger.plabrum.com'
// mcp.localhost:<port> is the local-dev MCP host (browsers and curl resolve *.localhost to loopback).
export const MCP_HOSTNAMES: ReadonlySet<string> = new Set(['mcp.roommate-ledger.plabrum.com', 'mcp.localhost'])

export type WorkerRoute =
  | { kind: 'mcp' } // /mcp on an MCP host
  | { kind: 'not-found' } // anything else on an MCP host, or /mcp on any other host
  | { kind: 'api' } // /api and /api/**
  | { kind: 'assets' } // everything else -> the SPA

function hostnameOf(hostHeader: string): string {
  return (hostHeader.split(':')[0] ?? '').toLowerCase()
}

const isUnder = (pathname: string, prefix: string): boolean => pathname === prefix || pathname.startsWith(`${prefix}/`)

/** Only `/mcp` is served on the MCP host, and `/mcp` is not served anywhere else. */
export function routeRequest(hostHeader: string, pathname: string): WorkerRoute {
  if (MCP_HOSTNAMES.has(hostnameOf(hostHeader))) {
    return pathname === '/mcp' ? { kind: 'mcp' } : { kind: 'not-found' }
  }
  if (isUnder(pathname, '/mcp')) return { kind: 'not-found' }
  if (isUnder(pathname, '/api')) return { kind: 'api' }
  return { kind: 'assets' }
}
