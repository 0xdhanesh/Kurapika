import { importFiles, importAssessmentText } from './assessment-import.js'
import { getRunIndex, importRuns } from './assessment-store.js'

self.onmessage = async ({ data }) => {
  try {
    let run
    if (data.files) run = await importFiles(data.files)
    else if (data.migrate) {
      run = await getRunIndex(...data.migrate)
      if (run && !run.paged) await importRuns([run])
    } else run = await importAssessmentText(data.text, data.filename)
    self.postMessage({ repository: run.repository, runId: run.runId })
  } catch (error) { self.postMessage({ error: error.message }) }
}
