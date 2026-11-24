import { normalizeAssessment, parseAssessment } from './assessment-format.js'
import { importRuns } from './assessment-store.js'

export function workerRequest(data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./assessment-worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      worker.terminate()
      if (data.error) reject(Error(data.error))
      else resolve(data)
    }
    worker.onerror = event => { worker.terminate(); reject(Error(event.message || 'Assessment worker failed.')) }
    worker.postMessage(data)
  })
}

async function readAssessment(file) {
  const filename = file.name.replace(/\.json$/i, '')
  if (file.size <= 512 * 1024) return parseAssessment(await file.text(), filename)
  const { JSONParser } = typeof process === 'undefined'
    ? await import('./vendor/streamparser/index.js') : await import('@streamparser/json')
  const parser = new JSONParser({ paths: ['$'], stringBufferSize: 65536 })
  let data
  parser.onValue = entry => { data = entry.value }
  const reader = file.stream().getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parser.write(value)
    }
    if (!parser.isEnded) parser.end()
  } finally { reader.releaseLock() }
  return normalizeAssessment(data, filename)
}

export async function importFiles(files) {
  if (typeof window !== 'undefined') return workerRequest({ files })
  const runs = []
  for (const file of files) {
    try {
      for (const run of await readAssessment(file)) runs.push(run)
    } catch (error) {
      throw Error(file.name + ': ' + error.message)
    }
  }
  await importRuns(runs)
  return runs.at(-1)
}

export async function importAssessmentText(text, filename) {
  if (typeof window !== 'undefined') return workerRequest({ text, filename })
  const runs = parseAssessment(text, filename)
  await importRuns(runs)
  return runs.at(-1)
}

export function assessmentURL({ repository, runId }) {
  const url = new URL('./assessments.html', location.href)
  url.search = new URLSearchParams({ repository, run: runId }).toString()
  return url
}
