// The build places a Map of compressed static files before this module.
import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'

const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT ?? 4173)
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('PORT must be an integer between 0 and 65535.')
  process.exit(1)
}

const server = createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  const path = request.url.split('?', 1)[0]
  const asset = assets.get(path === '/' ? '/index.html' : path)
  if (!asset) {
    response.writeHead(404).end()
    return
  }
  const [type, size, compressed] = asset
  response.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  })
  if (request.method === 'HEAD') response.end()
  else response.end(gunzipSync(Buffer.from(compressed, 'base64')))
})
server.on('error', error => {
  console.error('Could not start Kurapika:', error.message)
  process.exitCode = 1
})
server.listen(port, host, () => {
  const { address, port } = server.address()
  const hostname = address.includes(':') ? '[' + address + ']' : address
  console.log('Kurapika listening at http://' + hostname + ':' + port + '/')
})
