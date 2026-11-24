// Exercise the end-user distribution with no other project files on its path.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const directory = await mkdtemp(join(tmpdir(), 'kurapika-'))
let child
try {
  await copyFile('build/kurapika.mjs', join(directory, 'kurapika.mjs'))
  child = spawn(process.execPath, ['kurapika.mjs'], {
    cwd: directory, env: { ...process.env, HOST: '127.0.0.1', PORT: '0', PATH: '' },
    stdio: ['ignore', 'pipe', 'inherit']
  })
  const lines = createInterface({ input: child.stdout })
  const [banner] = await Promise.race([
    once(lines, 'line'),
    once(child, 'exit').then(([code]) => { throw Error('Launcher exited early: ' + code) })
  ])
  lines.close()
  const origin = new URL(banner.replace('Kurapika listening at ', ''))
  const page = await fetch(origin)
  assert.equal(await page.text(), await readFile('src/index.html', 'utf8'))
  const vendor = 'node_modules/mermaid/dist/'
  const chunks = 'chunks/mermaid.esm.min/'
  const files = [
    ...(await readdir('src')).map(name => [name, 'src/' + name]),
    ...(await readdir('node_modules/@streamparser/json/dist/mjs', { recursive: true }))
      .filter(name => name.endsWith('.js')).map(name => ['vendor/streamparser/' + name, 'node_modules/@streamparser/json/dist/mjs/' + name]),
    ['vendor/streamparser/LICENSE', 'licenses/streamparser-json.txt'],
    ['LICENSE', 'LICENSE'], ['vendor/LICENSE', 'node_modules/mermaid/LICENSE'],
    ['vendor/mermaid.esm.min.mjs', vendor + 'mermaid.esm.min.mjs'],
    ...(await readdir(vendor + chunks)).filter(name => name.endsWith('.mjs'))
      .map(name => ['vendor/' + chunks + name, vendor + chunks + name])
  ]
  for (const [path, original] of files) {
    const response = await fetch(new URL(path, origin))
    assert.equal(response.status, 200, path)
    if (path.endsWith('.json')) assert.match(response.headers.get('content-type'), /application\/json/)
    if (path.endsWith('.html')) assert.match(response.headers.get('content-type'), /text\/html/)
    if (/\.m?js$/.test(path)) assert.match(response.headers.get('content-type'), /javascript/)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(original), path)
  }
  assert.equal((await fetch(new URL('package.json', origin))).status, 404)
  console.log('Standalone Node launcher served all ' + files.length + ' workspace assets.')
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    child.kill()
    await exited
  }
  await rm(directory, { recursive: true, force: true })
}
