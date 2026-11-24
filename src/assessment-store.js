import { eventPageSize, isPagedText, mapNarratives, textPageSize } from './assessment-pages.js'
import { applyDelta, snapshotAt } from './assessment-format.js'

let connection

function database() {
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open('kurapika-assessments', 2)
      request.onupgradeneeded = event => {
        const db = request.result
        db.createObjectStore('eventPages')
        db.createObjectStore('textPages', { autoIncrement: true }).createIndex('content', 'content', { unique: true })
        if (event.oldVersion >= 1) return
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
  for (const table of ['nodes', 'relationships', 'chains']) {
    const rows = longer.initial[table]
    const other = shorter.initial[table]
    if (rows.length !== other.length || !rows.every((row, i) => JSON.stringify(row) === JSON.stringify(other[i]))) return false
  }
  const evidence = new Map(longer.evidence.map(record => [record.id, record]))
  return shorter.evidence.every(record => JSON.stringify(evidence.get(record.id)) === JSON.stringify(record))
    && shorter.events.every((event, i) => JSON.stringify(longer.events[i]) === JSON.stringify(event))
}

async function packText(run, store) {
  const pending = new Map()
  function intern(content) {
    if (!pending.has(content)) pending.set(content, (async () => {
      const found = await result(store.index('content').getKey(content))
      return found ?? await result(store.add({ content }))
    })())
    return pending.get(content)
  }
  return mapNarratives(run, async value => {
    if (isPagedText(value)) return value
    const parts = []
    for (let i = 0; i < value.length; i += textPageSize) parts.push(intern(value.slice(i, i + textPageSize)))
    return { textPages: await Promise.all(parts), length: value.length, hasText: !!value.trim() }
  })
}

const rowPageSize = 256
const tables = ['nodes', 'relationships', 'chains']

async function packRows(store, record, fields, prefix) {
  const packed = { ...record }
  for (const key of fields) {
    const rows = record[key]
    if (rows.length <= rowPageSize) continue
    packed[key] = { count: rows.length }
    for (let i = 0; i < rows.length; i += rowPageSize) {
      await result(store.put(rows.slice(i, i + rowPageSize), [...prefix, key, i / rowPageSize]))
    }
  }
  return packed
}

async function unpackRows(store, record, fields, prefix) {
  const unpacked = { ...record }
  for (const key of fields) {
    if (Array.isArray(record[key])) continue
    const rows = []
    for (let i = 0; i < record[key].count; i += rowPageSize) {
      rows.push(...await result(store.get([...prefix, key, i / rowPageSize])))
    }
    unpacked[key] = rows
  }
  return unpacked
}

function needsEventPages(events) {
  if (events.length > eventPageSize) return true
  let rows = 0
  for (const event of events) {
    for (const table of tables) rows += event[table].length + event.remove[table].length
  }
  return rows > rowPageSize
}

async function writePages(tx, run) {
  const store = tx.objectStore('eventPages')
  const key = [run.repository, run.runId]
  const initial = await packRows(store, run.initial, tables, [...key, 'initial'])
  const { evidence } = await packRows(store, run, ['evidence'], key)
  const index = { ...run, initial, evidence, paged: true }
  if (!needsEventPages(run.events)) return index
  for (let i = 0; i < run.events.length; i += eventPageSize) {
    const page = []
    for (let j = i; j < Math.min(i + eventPageSize, run.events.length); j++) {
      const event = await packRows(store, run.events[j], tables, [...key, 'stage', j])
      event.remove = await packRows(store, event.remove, tables, [...key, 'remove', j])
      page.push(event)
    }
    await result(store.put(page, [...key, i / eventPageSize]))
  }
  return { ...index, eventCount: run.events.length, events: [] }
}

async function unpackEvent(store, run, event, j) {
  const key = [run.repository, run.runId]
  const unpacked = await unpackRows(store, event, tables, [...key, 'stage', j])
  unpacked.remove = await unpackRows(store, event.remove, tables, [...key, 'remove', j])
  return unpacked
}

async function readEvents(run, readPage) {
  if (!run.eventCount) return run.events
  const events = []
  for (let i = 0; i < run.eventCount; i += eventPageSize) events.push(...await readPage(i / eventPageSize))
  return events
}

async function unpackIndex(tx, run) {
  if (!run?.paged) return run
  const store = tx.objectStore('eventPages')
  const key = [run.repository, run.runId]
  const index = await unpackRows(store, run, ['evidence'], key)
  index.initial = await unpackRows(store, run.initial, tables, [...key, 'initial'])
  return index
}

export function importRuns(runs) {
  return transaction(['runs', 'catalog', 'eventPages', 'textPages'], 'readwrite', async tx => {
    const store = tx.objectStore('runs')
    const catalog = tx.objectStore('catalog')
    let order = await result(catalog.count())
    for (const raw of runs) {
      const run = await packText(raw, tx.objectStore('textPages'))
      let existing = await result(store.get([run.repository, run.runId]))
      const large = needsEventPages(run.events) || run.initial.nodes.length > 32 || run.initial.relationships.length > 64
      if (existing) {
        existing = await unpackIndex(tx, existing)
        const metadata = await result(catalog.get([run.repository, run.runId]))
        if (!metadata.paged || (!metadata.large && large)) await result(catalog.put({ ...metadata, paged: true, large }))
        const legacy = !existing.paged
        if (legacy) existing = await packText(existing, tx.objectStore('textPages'))
        existing.events = await readEvents(existing, async n => {
          const store = tx.objectStore('eventPages')
          const page = await result(store.get([run.repository, run.runId, n]))
          return Promise.all(page.map((event, i) => unpackEvent(store, existing, event, n * eventPageSize + i)))
        })
        if (legacy && containsRun(existing, run)) {
          await result(store.put(await writePages(tx, existing)))
          continue
        }
        if (containsRun(existing, run)) continue
        if (!containsRun(run, existing)) {
          throw Error('Run "' + run.runId + '" already exists in ' + run.repository + ' with different observations. Append events or use a different runId.')
        }
        await result(store.put(await writePages(tx, run)))
        continue
      }
      await result(store.add(await writePages(tx, run)))
      await result(catalog.add({
        repository: run.repository, runId: run.runId, at: run.at, importedAt: new Date().toISOString(), order: ++order, paged: true, large
      }))
    }
  })
}

export async function listRuns() {
  const entries = await transaction('catalog', 'readonly', tx => result(tx.objectStore('catalog').getAll()))
  return entries.sort((a, b) => (b.at || b.importedAt).localeCompare(a.at || a.importedAt)
    || (b.order ?? 0) - (a.order ?? 0) || b.runId.localeCompare(a.runId))
}

export function getRunIndex(repository, runId) {
  return transaction(['runs', 'eventPages'], 'readonly', async tx => unpackIndex(tx, await result(tx.objectStore('runs').get([repository, runId]))))
}

export function readTextPage(id) {
  return transaction('textPages', 'readonly', async tx => (await result(tx.objectStore('textPages').get(id))).content)
}

function eventPage(run, n) {
  return transaction('eventPages', 'readonly', tx => result(tx.objectStore('eventPages').get([run.repository, run.runId, n])))
}

export async function getRun(repository, runId) {
  const index = await getRunIndex(repository, runId)
  if (!index) return index
  const { paged, eventCount, ...run } = index
  run.events = await readEvents(index, async n => {
    const page = await eventPage(index, n)
    return transaction('eventPages', 'readonly', tx => Promise.all(page.map((event, i) =>
      unpackEvent(tx.objectStore('eventPages'), index, event, n * eventPageSize + i))))
  })
  return mapNarratives(run, async value => isPagedText(value)
    ? (await Promise.all(value.textPages.map(readTextPage))).join('') : value)
}

// Each cursor belongs to one run. Navigation is serialized by the caller.
export function stageCursor(run) {
  const count = run.eventCount ?? run.events.length
  const cache = new Map()
  function page(n) {
    if (!cache.has(n)) cache.set(n, eventPage(run, n))
    return cache.get(n)
  }
  let position = 0
  let graph = snapshotAt(run, 0)
  let last
  return { count, async seek(step, cancelled = () => false) {
    if (step < position) { graph = snapshotAt(run, 0); position = 0; last = undefined }
    while (position < step) {
      const n = Math.floor(position / eventPageSize)
      last = run.eventCount ? (await page(n))[position % eventPageSize] : run.events[position]
      if (run.eventCount && tables.some(t => !Array.isArray(last[t]) || !Array.isArray(last.remove[t]))) {
        last = await transaction('eventPages', 'readonly', tx => unpackEvent(tx.objectStore('eventPages'), run, last, position))
      }
      applyDelta(graph, last)
      position++
      if (cancelled()) return
      if (position % eventPageSize === 0) cache.delete(n - 1)
    }
    if (run.eventCount) {
      const nearby = Math.floor(step / eventPageSize)
      for (const key of cache.keys()) if (Math.abs(key - nearby) > 1) cache.delete(key)
      if (nearby * eventPageSize < count) page(nearby).catch(() => cache.delete(nearby))
    }
    return { graph, event: last }
  } }
}

// Only an explicit human save can append to this store. Keep the originating run and replay position.
export function saveReview(record) {
  return transaction('reviews', 'readwrite', tx => result(tx.objectStore('reviews').add(record)))
}

export function listReviews(repository) {
  return transaction('reviews', 'readonly', tx => result(tx.objectStore('reviews').index('repository').getAll(repository)))
}
