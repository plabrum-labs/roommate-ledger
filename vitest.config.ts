import { fileURLToPath } from 'node:url'

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

import { standardDecorators } from './vite.decorators'

export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL('./drizzle', import.meta.url)))
  return {
    plugins: [
      standardDecorators(),
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } }
      })
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
    },
    test: {
      include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
      setupFiles: ['./test/apply-migrations.ts']
    }
  }
})
