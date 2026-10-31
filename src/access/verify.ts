// Mirrors soren-em-wedding src/server/platform/security/access.ts; extract on third use.
import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'

import type { AccessConfig } from './config'

const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion'
const ACCESS_JWT_COOKIE = 'CF_Authorization'

const emailSchema = z.email()

/** Who Cloudflare Access says is calling; `dev_bypass` is the local-only stand-in with no verification. */
export type AccessIdentity = { kind: 'verified'; email: string } | { kind: 'dev_bypass' }

/** The caller presented no valid Access assertion. */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

function readAccessToken(req: Request): string | null {
  const header = req.headers.get(ACCESS_JWT_HEADER)
  if (header) return header
  const cookieHeader = req.headers.get('cookie')
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (name === ACCESS_JWT_COOKIE) return part.slice(eq + 1).trim()
  }
  return null
}

const remoteJwks = new Map<string, JWTVerifyGetKey>()

function remoteJwksFor(teamDomain: string): JWTVerifyGetKey {
  let jwks = remoteJwks.get(teamDomain)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`))
    remoteJwks.set(teamDomain, jwks)
  }
  return jwks
}

/**
 * Builds a per-request identifier from a Cloudflare Access JWT (`cf-access-jwt-assertion` header, else the
 * `CF_Authorization` cookie). `bypass` skips verification entirely.
 */
export function createAccessIdentifier(
  cfg: Extract<AccessConfig, { kind: 'verify' | 'bypass' }>,
  jwks?: JWTVerifyGetKey
): (req: Request) => Promise<AccessIdentity> {
  if (cfg.kind === 'bypass') {
    return () => Promise.resolve({ kind: 'dev_bypass' })
  }
  const { teamDomain, audiences } = cfg
  return async (req: Request): Promise<AccessIdentity> => {
    const token = readAccessToken(req)
    if (!token) throw new UnauthorizedError('No Cloudflare Access assertion on the request')
    try {
      const { payload } = await jwtVerify(token, jwks ?? remoteJwksFor(teamDomain), {
        issuer: `https://${teamDomain}`,
        audience: audiences,
        algorithms: ['RS256']
      })
      const email = emailSchema.parse(payload.email).toLowerCase()
      return { kind: 'verified', email }
    } catch {
      throw new UnauthorizedError('Invalid Cloudflare Access assertion')
    }
  }
}
