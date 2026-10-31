# Roommate Ledger MCP server

A remote MCP server in the Worker at `https://mcp.roommate-ledger.plabrum.com/mcp`, modelled on the soren-em-wedding
guest-list MCP. Sign-in uses Cloudflare Access **Managed OAuth** (beta): Access itself runs the OAuth login claude.ai
and Claude Code need (discovery, dynamic client registration, PKCE), using the same one-time PIN and `allowed_emails`
as the main app. The Worker then verifies the signed Access assertion against the MCP app's AUD (`MCP_ACCESS_AUD`).

Design and tool list: `docs/design.md` ("MCP server").

## Auth behaviour

|                      | production (built Worker)                                                                                                                         | `npm run dev`         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `/mcp` (MCP host)    | `MCP_ACCESS_AUD` blank (or team domain blank): **503 `MCP not configured`**. Set: a valid Access JWT for that AUD is required, else 401           | no check (dev bypass) |
| `/api/*` (main host) | `CF_ACCESS_AUD` set: a valid Access JWT for it is required, else 401 (defence in depth behind the edge). Blank: edge-only. Team domain blank: 503 | no check (dev bypass) |

Production vs dev is `import.meta.env.PROD`, so `npm run preview` (a production build) behaves like production: with
`MCP_ACCESS_AUD` blank `/mcp` answers 503 there.

Only `/mcp` is served on the MCP host (everything else is a JSON 404, including the SPA), and `/mcp` on the main host is a 404. The Worker runs first for every request (`assets.run_worker_first`) so the SPA can never be served on the MCP host.
Managed OAuth's `/.well-known/oauth-*` paths are answered by Access at the edge and never reach the Worker.

## Rollout

1. **Terraform apply** (merge the `infra/` change; CI plans on the PR and applies on `main`). This creates the
   `roommate-ledger mcp` Access app on `mcp.roommate-ledger.plabrum.com` with Managed OAuth: dynamic client registration
   on, localhost/loopback redirects allowed (Claude Code), `https://claude.ai/api/mcp/auth_callback` allowed, 1h access
   tokens and 30-day sessions. If the plan rejects `oauth_configuration`, drop that block from `infra/access.tf` and
   set the same options in the dashboard (Zero Trust, Access, Applications, _roommate-ledger mcp_, Managed OAuth).
2. **Copy the AUDs.** `terraform output access_aud` goes into `wrangler.jsonc` `vars.CF_ACCESS_AUD` (already set) and
   `terraform output mcp_access_aud` into `vars.MCP_ACCESS_AUD`. Then `npm run cf-typegen`.
3. **Deploy** by merging to `main` (the Deploy workflow). The Worker gets the `mcp.` custom domain; until step 2 is
   deployed `/mcp` answers 503.
4. **Check.** `curl -i https://mcp.roommate-ledger.plabrum.com/mcp` is answered by Access, not the Worker: a 401 with a
   `WWW-Authenticate` header pointing at `/.well-known/oauth-authorization-server`, or a redirect to login.

No new secrets or storage are needed.

## Connecting

- **claude.ai** (also gives you phone and desktop): Settings, Connectors, _Add custom connector_; name it
  `Roommate Ledger`, URL `https://mcp.roommate-ledger.plabrum.com/mcp`; _Connect_ and log in with your email and PIN.
- **Claude Code:** `claude mcp add --transport http roommate-ledger https://mcp.roommate-ledger.plabrum.com/mcp`, then `/mcp`
  to log in.
- Anyone Access lets through (the `allowed_emails` list) is the owner; there is no per-user data.

## Local dev

`npm run dev`, then
`claude mcp add --transport http roommate-ledger-local http://mcp.localhost:5173/mcp` (use the port Vite prints).
No login locally. Raw check:

```sh
curl -s http://mcp.localhost:5173/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## If claude.ai can't connect (Managed OAuth is beta)

The documented alternative is running our own OAuth server in the Worker with `@cloudflare/workers-oauth-provider`,
with Access for SaaS (OIDC) as the upstream login (needs a KV namespace and two secrets). See
https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/ and
https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/saas-mcp/.
