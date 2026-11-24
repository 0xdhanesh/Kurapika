let connection

function database() {
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open('kurapika-assessments', 1)
      request.onupgradeneeded = () => {
        const db = request.result
        const keyPath = ['repository', 'runId']
        db.createObjectStore('runs', { keyPath })
        db.createObjectStore('catalog', { keyPath })
        const reviews = db.createObjectStore('reviews', { autoIncrement: true })
        reviews.createIndex('repository', 'repository')
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => { db.close(); connection = undefined }
        resolve(db)
      }
    }).catch(error => { connection = undefined; throw error })
  }
  return connection
}

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transaction(stores, mode, perform) {
  const db = await database()
  const tx = db.transaction(stores, mode)
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onabort = () => reject(tx.error ?? Error('Storage transaction aborted.'))
  })
  try {
    const [value] = await Promise.all([perform(tx), done])
    return value
  } catch (error) {
    try { tx.abort() } catch { /* The transaction already ended. */ }
    throw error
  }
}

// The initial graph and all previously observed events must agree. A reimport may
// extend a running assessment, and retrying an older compatible file is harmless.
function containsRun(longer, shorter) {
  if (longer.at !== shorter.at || longer.events.length < shorter.events.length) return false
  if (JSON.stringify(longer.initial) !== JSON.stringify(shorter.initial)) return false
  const evidence = new Map(longer.evidence.map(record => [record.id, record]))
  return shorter.evidence.every(record => JSON.stringify(evidence.get(record.id)) === JSON.stringify(record))
    && shorter.events.every((event, i) => JSON.stringify(longer.events[i]) === JSON.stringify(event))
}

export function importRuns(runs) {
  return transaction(['runs', 'catalog'], 'readwrite', async tx => {
    const store = tx.objectStore('runs')
    const catalog = tx.objectStore('catalog')
    let order = await result(catalog.count())
    for (const run of runs) {
      const existing = await result(store.get([run.repository, run.runId]))
      if (existing) {
        if (containsRun(existing, run)) continue
        if (!containsRun(run, existing)) {
          throw Error('Run "' + run.runId + '" already exists in ' + run.repository + ' with different observations. Append events or use a different runId.')
        }
        await result(store.put(run))
        continue
      }
      await result(store.add(run))
      await result(catalog.add({
        repository: run.repository, runId: run.runId, at: run.at, importedAt: new Date().toISOString(), order: ++order
      }))
    }
  })
}

export async function listRuns() {
  const entries = await transaction('catalog', 'readonly', tx => result(tx.objectStore('catalog').getAll()))
  return entries.sort((a, b) => (b.at || b.importedAt).localeCompare(a.at || a.importedAt)
    || (b.order ?? 0) - (a.order ?? 0) || b.runId.localeCompare(a.runId))
}

export function getRun(repository, runId) {
  return transaction('runs', 'readonly', tx => result(tx.objectStore('runs').get([repository, runId])))
}

// Only an explicit human save can append to this store. Keep the originating run and replay position.
export function saveReview(record) {
  return transaction('reviews', 'readwrite', tx => result(tx.objectStore('reviews').add(record)))
}

export function listReviews(repository) {
  return transaction('reviews', 'readonly', tx => result(tx.objectStore('reviews').index('repository').getAll(repository)))
}
