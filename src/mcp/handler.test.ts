import { exports } from 'cloudflare:workers'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { apiAccessConfig, mcpAccessConfig, type AccessConfig, type AccessVars } from '@/access/config'
import { guardApi } from '@/access/guard'
import { createAccessIdentifier } from '@/access/verify'
import type { Ctx } from '@/api/context'
import { ME } from '@/ledger'
import { routeRequest } from '@/lib/host-routing'
import { freshDb } from '@/testing/helpers'

import { handleMcpRoute } from './handler'

const TEAM = 'team.cloudflareaccess.com'
const AUD = 'mcp-aud'
const verify: AccessConfig = { kind: 'verify', teamDomain: TEAM, audiences: [AUD] }

let privateKey: CryptoKey
let identify: ReturnType<typeof createAccessIdentifier>
let ctx: Ctx

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), alg: 'RS256', kid: 'k1' }
  identify = createAccessIdentifier(verify, createLocalJWKSet({ keys: [jwk] }))
})

beforeEach(async () => {
  ctx = { db: await freshDb(), me: ME }
})

const sign = (email: string, aud = AUD, issuer = `https://${TEAM}`): Promise<string> =>
  new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(issuer)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)

const rpc = (method: string, params: Record<string, unknown> = {}): string =>
  JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })

function mcpRequest(jwt?: string, url = 'https://mcp.roommate-ledger.plabrum.com/mcp'): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      ...(jwt ? { 'cf-access-jwt-assertion': jwt } : {})
    },
    body: rpc('tools/list')
  })
}

const toolNames = async (res: Response): Promise<string[]> =>
  (await res.json<{ result: { tools: { name: string }[] } }>()).result.tools.map(t => t.name)

describe('handleMcpRoute', () => {
  it('503 when disabled', async () => {
    const res = await handleMcpRoute(mcpRequest(), ctx, { kind: 'disabled' })
    expect(res.status).toBe(503)
  })

  it('401 without an assertion, with a wrong audience, issuer or garbage', async () => {
    expect((await handleMcpRoute(mcpRequest(), ctx, verify, identify)).status).toBe(401)
    expect((await handleMcpRoute(mcpRequest(await sign('a@b.co', 'other')), ctx, verify, identify)).status).toBe(401)
    expect(
      (await handleMcpRoute(mcpRequest(await sign('a@b.co', AUD, 'https://evil.example')), ctx, verify, identify))
        .status
    ).toBe(401)
    expect((await handleMcpRoute(mcpRequest('garbage'), ctx, verify, identify)).status).toBe(401)
  })

  it('serves tools/list for a valid assertion, from the header or the CF_Authorization cookie', async () => {
    const jwt = await sign('Me@Example.com')
    const res = await handleMcpRoute(mcpRequest(jwt), ctx, verify, identify)
    expect(res.status).toBe(200)
    expect(await toolNames(res)).toContain('record_payment')
    const cookie = new Request('https://mcp.roommate-ledger.plabrum.com/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'cookie': `CF_Authorization=${jwt}`
      },
      body: rpc('tools/list')
    })
    expect((await handleMcpRoute(cookie, ctx, verify, identify)).status).toBe(200)
  })

  it('whoami reports the verified, lowercased email', async () => {
    const req = new Request('https://mcp.roommate-ledger.plabrum.com/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'cf-access-jwt-assertion': await sign('Me@Example.com')
      },
      body: rpc('tools/call', { name: 'whoami', arguments: {} })
    })
    const res = await handleMcpRoute(req, ctx, verify, identify)
    const body = await res.json<{ result: { structuredContent: { email: string } } }>()
    expect(body.result.structuredContent.email).toBe('me@example.com')
  })

  it('dev bypass needs no assertion', async () => {
    const res = await handleMcpRoute(mcpRequest(), ctx, { kind: 'bypass' })
    expect(res.status).toBe(200)
  })
})

describe('access config', () => {
  const vars = (over: Partial<AccessVars> = {}): AccessVars => ({
    CF_ACCESS_TEAM_DOMAIN: TEAM,
    CF_ACCESS_AUD: '',
    MCP_ACCESS_AUD: '',
    ...over
  })

  it('/mcp is disabled in production while MCP_ACCESS_AUD is blank, bypassed in dev, verified once set', () => {
    expect(mcpAccessConfig(vars(), true)).toEqual({ kind: 'disabled' })
    expect(mcpAccessConfig(vars({ MCP_ACCESS_AUD: ' , ' }), true)).toEqual({ kind: 'disabled' })
    expect(mcpAccessConfig(vars({ MCP_ACCESS_AUD: 'a', CF_ACCESS_TEAM_DOMAIN: '' }), true)).toEqual({
      kind: 'disabled'
    })
    expect(mcpAccessConfig(vars(), false)).toEqual({ kind: 'bypass' })
    expect(mcpAccessConfig(vars({ MCP_ACCESS_AUD: 'a, b' }), true)).toEqual({
      kind: 'verify',
      teamDomain: TEAM,
      audiences: ['a', 'b']
    })
  })

  it('/api is edge-only while CF_ACCESS_AUD is blank, verified once set, fails closed without a team domain', () => {
    expect(apiAccessConfig(vars(), true)).toEqual({ kind: 'bypass' })
    expect(apiAccessConfig(vars({ CF_ACCESS_AUD: 'x' }), true)).toMatchObject({ kind: 'verify', audiences: ['x'] })
    expect(apiAccessConfig(vars({ CF_ACCESS_AUD: 'x' }), false)).toEqual({ kind: 'bypass' })
    expect(apiAccessConfig(vars({ CF_ACCESS_TEAM_DOMAIN: '' }), true)).toEqual({ kind: 'disabled' })
  })
})

describe('guardApi', () => {
  const api = (jwt?: string): Request =>
    new Request('https://roommate-ledger.plabrum.com/api/balances', {
      headers: jwt ? { 'cf-access-jwt-assertion': jwt } : {}
    })

  it('passes a valid assertion and refuses missing or wrong-audience ones', async () => {
    expect(await guardApi(api(await sign('a@b.co')), verify, identify)).toBeNull()
    expect((await guardApi(api(), verify, identify))?.status).toBe(401)
    expect((await guardApi(api(await sign('a@b.co', 'other')), verify, identify))?.status).toBe(401)
  })

  it('lets everything through on bypass and refuses on disabled', async () => {
    expect(await guardApi(api(), { kind: 'bypass' })).toBeNull()
    expect((await guardApi(api(), { kind: 'disabled' }))?.status).toBe(503)
  })
})

describe('host routing', () => {
  it('serves only /mcp on the MCP host and never /mcp elsewhere', () => {
    expect(routeRequest('mcp.roommate-ledger.plabrum.com', '/mcp')).toEqual({ kind: 'mcp' })
    expect(routeRequest('MCP.localhost:5173', '/mcp')).toEqual({ kind: 'mcp' })
    for (const path of ['/', '/api/balances', '/mcp/x', '/index.html', '/.well-known/x']) {
      expect(routeRequest('mcp.roommate-ledger.plabrum.com', path)).toEqual({ kind: 'not-found' })
    }
    expect(routeRequest('roommate-ledger.plabrum.com', '/mcp')).toEqual({ kind: 'not-found' })
    expect(routeRequest('roommate-ledger.plabrum.com', '/mcp/x')).toEqual({ kind: 'not-found' })
    expect(routeRequest('roommate-ledger.plabrum.com', '/api/balances')).toEqual({ kind: 'api' })
    expect(routeRequest('roommate-ledger.plabrum.com', '/split')).toEqual({ kind: 'assets' })
  })
})

describe('the Worker', () => {
  const post = (url: string): Promise<Response> =>
    exports.default.fetch(
      new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
        body: rpc('tools/list')
      })
    )

  it('answers /mcp on the MCP host (dev bypass under test) with the tool list', async () => {
    const res = await post('http://mcp.localhost/mcp')
    expect(res.status).toBe(200)
    expect(await toolNames(res)).toHaveLength(14)
  })

  it('404s the wrong path on the MCP host and /mcp on the main host', async () => {
    expect((await post('http://mcp.localhost/other')).status).toBe(404)
    expect((await exports.default.fetch('http://mcp.localhost/')).status).toBe(404)
    expect((await post('http://roommate-ledger.plabrum.com/mcp')).status).toBe(404)
    expect((await post('http://localhost/mcp')).status).toBe(404)
  })

  it('initializes over HTTP', async () => {
    const res = await exports.default.fetch(
      new Request('http://mcp.localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
        body: rpc('initialize', {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 't', version: '1' }
        })
      })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ result: { serverInfo: { name: 'roommate-ledger' } } })
  })
})
