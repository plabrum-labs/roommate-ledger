import { writeFile } from 'node:fs/promises'

import { openApiText } from '../src/api/router'

const target = new URL('../openapi.json', import.meta.url)
await writeFile(target, await openApiText())
console.warn(`wrote ${target.pathname}`)
