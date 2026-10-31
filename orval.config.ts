import { defineConfig } from 'orval'

// ORVAL_OUT lets `scripts/check-openapi.ts` regenerate into a scratch directory.
const out = process.env.ORVAL_OUT ?? './src/api-client/generated'

export default defineConfig({
  ledger: {
    input: { target: './openapi.json' },
    output: {
      mode: 'tags-split',
      target: out,
      schemas: `${out}/model`,
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      override: {
        mutator: { path: './src/api-client/fetcher.ts', name: 'customFetch' },
        query: { useQuery: false, useSuspenseQuery: true }
      }
    }
  }
})
