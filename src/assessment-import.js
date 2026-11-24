import { importLimit, parseAssessment } from './assessment-format.js'
import { importRuns } from './assessment-store.js'

export async function readGraphFile(file) {
  if (file.size > importLimit * 4) throw Error(file.name + ' exceeds the 2 million character limit.')
  const text = await file.text()
  if (text.length > importLimit) throw Error(file.name + ' exceeds the 2 million character limit.')
  return text
}

export async function importFiles(files) {
  const runs = []
  for (const file of files) {
    try {
      runs.push(...parseAssessment(await readGraphFile(file), file.name.replace(/\.json$/i, '')))
    } catch (error) {
      throw Error(file.name + ': ' + error.message)
    }
  }
  await importRuns(runs)
  return runs.at(-1)
}

export async function importAssessmentText(text, filename) {
  const runs = parseAssessment(text, filename)
  await importRuns(runs)
  return runs.at(-1)
}

export function assessmentURL({ repository, runId }) {
  const url = new URL('./assessments.html', location.href)
  url.search = new URLSearchParams({ repository, run: runId }).toString()
  return url
}
