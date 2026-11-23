import { cp, mkdir, readFile } from 'node:fs/promises'

await mkdir('dist/vendor', { recursive: true })
await cp('src', 'dist', { recursive: true })
const vendor = 'node_modules/mermaid/dist'
await cp(vendor + '/mermaid.esm.min.mjs', 'dist/vendor/mermaid.esm.min.mjs')
await cp(vendor + '/chunks/mermaid.esm.min', 'dist/vendor/chunks/mermaid.esm.min', {
  recursive: true,
  filter: path => !path.endsWith('.map')
})
await cp('node_modules/mermaid/LICENSE', 'dist/vendor/LICENSE')
const { version } = JSON.parse(await readFile('node_modules/mermaid/package.json'))
console.log('Built static workspace with Mermaid ' + version)
