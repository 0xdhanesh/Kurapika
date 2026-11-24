import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { gzipSync } from 'node:zlib'

const vendor = 'node_modules/mermaid/dist'
const chunks = 'chunks/mermaid.esm.min'
const assets = []
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8'
}

async function addFile(source, destination) {
  const contents = await readFile(source)
  const output = join('dist', destination)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, contents)
  const type = types[extname(destination)] ?? 'application/octet-stream'
  assets.push(['/' + destination, [type, contents.length, gzipSync(contents).toString('base64')]])
}

async function addDirectory(source, destination) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const path = join(source, entry.name)
    const name = destination + entry.name
    if (entry.isDirectory()) await addDirectory(path, name + '/')
    else if (entry.isFile() && !name.endsWith('.map')) await addFile(path, name)
  }
}

await addDirectory('src', '')
await addFile('LICENSE', 'LICENSE')
await addFile(vendor + '/mermaid.esm.min.mjs', 'vendor/mermaid.esm.min.mjs')
await addDirectory(vendor + '/' + chunks, 'vendor/' + chunks + '/')
await addFile('node_modules/mermaid/LICENSE', 'vendor/LICENSE')

const server = await readFile('scripts/serve.mjs', 'utf8')
await mkdir('build', { recursive: true })
await writeFile('build/kurapika.mjs', 'const assets = new Map(' + JSON.stringify(assets) + ')\n' + server)
const { version } = JSON.parse(await readFile('node_modules/mermaid/package.json'))
console.log('Built dist/ and build/kurapika.mjs with Mermaid ' + version)
