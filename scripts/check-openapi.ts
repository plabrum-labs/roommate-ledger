import { execFileSync } from 'node:child_process'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { openApiText } from '../src/api/router'

/**
 * Fails when the committed `openapi.json` or the Orval output in `src/api-client/generated`
 * differs from what the current controllers would produce. Orval is rerun into a sibling
 * directory (same depth, so relative mutator imports are identical) which is always removed.
 */
const root = new URL('..', import.meta.url).pathname
const generated = join(root, 'src/api-client/generated')
const scratch = join(root, 'src/api-client/generated-check')

async function files(dir: string, prefix = ''): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = join(prefix, entry.name)
    if (entry.isDirectory()) for (const [k, v] of await files(join(dir, entry.name), rel)) out.set(k, v)
    else out.set(rel, await readFile(join(dir, entry.name), 'utf8'))
  }
  return out
}

const problems: string[] = []
if ((await readFile(join(root, 'openapi.json'), 'utf8').catch(() => '')) !== (await openApiText())) {
  problems.push('openapi.json is out of date')
}

try {
  execFileSync('npx', ['orval'], { cwd: root, stdio: 'ignore', env: { ...process.env, ORVAL_OUT: scratch } })
  const [expected, actual] = await Promise.all([
    files(scratch),
    files(generated).catch(() => new Map<string, string>())
  ])
  for (const key of new Set([...expected.keys(), ...actual.keys()])) {
    if (expected.get(key) !== actual.get(key)) problems.push(`src/api-client/generated/${key} is out of date`)
  }
} finally {
  await rm(scratch, { recursive: true, force: true })
}

if (problems.length > 0) {
  console.error(`${problems.join('\n')}\nrun \`npm run openapi\``)
  process.exit(1)
}
console.warn('openapi.json and generated client are up to date')
