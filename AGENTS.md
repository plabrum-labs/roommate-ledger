# Conventions

Design: `docs/design.md`. Commands: see `README.md`.

- Money is integer cents. Never floats.
- Schemas: same-named zod schema and type, `export const X = z.object({...}); export type X = z.infer<typeof X>`.
- `src/framework/` is generic and must never import from app code (`ledger`, `domain`, `api`, `db`, `routes`); ESLint enforces it.
- No `any`, no `@ts-ignore` / `@ts-expect-error` / `eslint-disable` to dodge type errors.
- TypeScript 5 standard decorators only (no `experimentalDecorators`, no `emitDecoratorMetadata`).
- Never deploy and never create remote Cloudflare resources (`wrangler deploy`, `wrangler d1 create`, remote migrations).
  The D1 `database_id` is a placeholder; use `--local` only.
- Do not edit `package.json` from feature work without need; all tooling dependencies are already installed.
- Generated, do not hand-edit: `src/routeTree.gen.ts`, `src/api-client/generated`, `worker-configuration.d.ts`, `openapi.json`.
