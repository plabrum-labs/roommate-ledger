/** The Access-related bindings from wrangler.jsonc `vars`. */
export interface AccessVars {
  CF_ACCESS_TEAM_DOMAIN: string
  /** AUD(s) of the main app's Access application, comma-separated. Blank until the first Terraform apply. */
  CF_ACCESS_AUD: string
  /** AUD(s) of the MCP Access application, comma-separated. Blank until the first Terraform apply. */
  MCP_ACCESS_AUD: string
}

/**
 * How a surface authenticates callers:
 * - `verify`: a valid Cloudflare Access JWT for one of `audiences` is required.
 * - `bypass`: no verification (local dev, or a surface Access already guards at the edge and nothing is configured).
 * - `disabled`: refuse everything with 503 (fail closed).
 */
export type AccessConfig =
  { kind: 'verify'; teamDomain: string; audiences: string[] } | { kind: 'bypass' } | { kind: 'disabled' }

const audiencesOf = (raw: string): string[] =>
  raw
    .split(',')
    .map(aud => aud.trim())
    .filter(aud => aud.length > 0)

/**
 * `/api/*` on the main host. Access already guards the hostname at the edge, so this is defence in depth:
 * - dev: bypass.
 * - production, team domain blank: disabled (fail closed).
 * - production, `CF_ACCESS_AUD` blank: bypass (edge-only) so the app works between the first deploy and the
 *   Terraform apply that yields the AUD.
 * - production, both set: verify.
 */
export function apiAccessConfig(vars: AccessVars, production: boolean): AccessConfig {
  if (!production) return { kind: 'bypass' }
  if (vars.CF_ACCESS_TEAM_DOMAIN === '') return { kind: 'disabled' }
  const audiences = audiencesOf(vars.CF_ACCESS_AUD)
  return audiences.length === 0
    ? { kind: 'bypass' }
    : { kind: 'verify', teamDomain: vars.CF_ACCESS_TEAM_DOMAIN, audiences }
}

/**
 * `/mcp` on the MCP host. Unlike `/api`, a blank AUD never means "unchecked": a remote tool server that can
 * record payments fails closed.
 * - dev: bypass.
 * - production, team domain or `MCP_ACCESS_AUD` blank: disabled (503).
 * - production, both set: verify.
 */
export function mcpAccessConfig(vars: AccessVars, production: boolean): AccessConfig {
  if (!production) return { kind: 'bypass' }
  const audiences = audiencesOf(vars.MCP_ACCESS_AUD)
  return vars.CF_ACCESS_TEAM_DOMAIN === '' || audiences.length === 0
    ? { kind: 'disabled' }
    : { kind: 'verify', teamDomain: vars.CF_ACCESS_TEAM_DOMAIN, audiences }
}
