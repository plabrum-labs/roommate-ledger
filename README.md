# Roommate Ledger

Tracks the utility bills I pay and what my roommates owe me for them. Double-entry ledger on Cloudflare D1, oRPC API,
Vite + React + TanStack Router frontend, all served from one Cloudflare Worker. See `docs/design.md`.

## Scripts

| Script                      | What it does                                                          |
| --------------------------- | --------------------------------------------------------------------- |
| `npm run dev`               | Vite dev server (Worker runs in workerd via the Cloudflare plugin)    |
| `npm run build` / `preview` | Production build / serve it locally                                   |
| `npm run type-check`        | Generate the route tree, then `tsc --noEmit`                          |
| `npm run lint` / `format`   | ESLint (type-aware, strict) / Prettier check                          |
| `npm test`                  | Vitest inside workerd with a real local D1, migrations auto-applied   |
| `npm run cf-typegen`        | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` |
| `npm run db:generate`       | `drizzle-kit generate`: diff `src/db/schema.ts` into `drizzle/` SQL   |
| `npm run db:migrate:local`  | Apply migrations to the local D1                                      |
| `npm run openapi`           | Write `openapi.json` from the controllers, then run Orval             |
| `npm run orval`             | Generate the API client into `src/api-client/generated`               |

The D1 `database_id` in `wrangler.jsonc` is a placeholder. Nothing here deploys or touches a Cloudflare account.

## MCP server

Claude can read the ledger and make a few guarded writes through a remote MCP server at `/mcp` on
`mcp.roommate-ledger.plabrum.com` (Cloudflare Access Managed OAuth; local dev has no login at
`http://mcp.localhost:<port>/mcp`). `/mcp` answers 503 in production until `MCP_ACCESS_AUD` is set in
`wrangler.jsonc`. Setup, rollout and connecting claude.ai / Claude Code: `docs/mcp-setup.md`.

## Deploying

CI only; never from a laptop. `infra/` (Terraform, state in R2 bucket `plabrum-tf-state` via the S3 backend) owns the D1 database and the
Cloudflare Access apps; wrangler owns the Worker and its custom domains `roommate-ledger.plabrum.com` and `mcp.roommate-ledger.plabrum.com`.

1. Merge an `infra/` change: the **Terraform** workflow plans on the PR (posted as a comment) and applies on `main`.
2. After the first apply, copy `terraform output d1_database_id` into `wrangler.jsonc` and push.
3. Every push to `main` runs **Deploy**: checks, tests, build, `wrangler d1 migrations apply --remote`, `wrangler deploy`.
   Deploy skips the last two while `database_id` is still the placeholder.
