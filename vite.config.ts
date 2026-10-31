import { fileURLToPath } from 'node:url'

import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { standardDecorators } from './vite.decorators'

// vitest.config.ts is separate: vitest prefers it, so the Cloudflare vite plugin never loads under tests.
export default defineConfig({
  plugins: [standardDecorators(), tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), cloudflare()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  }
})
