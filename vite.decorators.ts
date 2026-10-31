import { transform } from 'esbuild'
import type { Plugin } from 'vite'

/**
 * Vite 8's oxc transformer does not lower TC39 standard decorators, but esbuild does.
 * Files that use decorator syntax are pre-lowered with esbuild before oxc sees them.
 */
export function standardDecorators(): Plugin {
  return {
    name: 'standard-decorators',
    enforce: 'pre',
    async transform(code, id) {
      if (!/\.tsx?$/.test(id) || id.includes('/node_modules/') || !/^\s*@[A-Za-z_$]/m.test(code)) return null
      const result = await transform(code, {
        loader: id.endsWith('x') ? 'tsx' : 'ts',
        target: 'es2022',
        sourcefile: id,
        sourcemap: 'external',
        tsconfigRaw: { compilerOptions: { experimentalDecorators: false } }
      })
      return { code: result.code, map: result.map }
    }
  }
}
