import { saveReview } from './assessment-store.js'
import { $, element } from './assessment-ui.js'

export function bindReviews() {
  let repository
  let context
  let history = []
  const latest = new Map()
  const drafts = new Map()
  const labels = new Map([...$('decision').options].map(option => [option.value, option.text]))
  let saving = false

  function readFields() {
    return { decision: $('decision').value, references: $('review-refs').value, notes: $('review-notes').value }
  }

  function display() {
    if (!context) return
    const { table, id } = context
    const key = JSON.stringify([table, id])
    const entries = history.filter(r => r.table === table && r.id === id)
    const last = latest.get(key)
    $('review-tab').textContent = last ? 'Human review · ' + labels.get(last.decision) : 'Human review'
    const pending = drafts.get(context.draftKey)
    const fields = pending ?? last
    $('decision').value = fields?.decision ?? ''
    $('review-refs').value = fields?.references ?? ''
    $('review-notes').value = fields?.notes ?? ''
    $('review-origin').textContent = last
      ? 'Last saved on ' + last.runId + ' · step ' + last.step + ' · ' + new Date(last.at).toLocaleString()
      : 'No human review recorded.'
    $('review-feedback').textContent = pending ? 'Unsaved changes' : ''
    $('save-review').disabled = saving || !pending
    $('review-history').hidden = !entries.length
    const list = $('review-history').querySelector('ul')
    list.replaceChildren(...entries.reverse().map(record => element('li', [
      labels.get(record.decision), record.runId + ' · step ' + record.step,
      new Date(record.at).toLocaleString(), record.references, record.notes
    ].filter(Boolean).join('\n'))))
  }

  $('review-form').oninput = () => {
    if (!context) return
    drafts.set(context.draftKey, readFields())
    $('save-review').disabled = saving
    $('review-feedback').textContent = 'Unsaved changes'
  }

  $('review-form').onsubmit = async event => {
    event.preventDefault()
    if (!context || saving) return
    const target = context
    const fields = drafts.get(target.draftKey)
    if (!fields) return
    const record = { repository, table: target.table, id: target.id, runId: target.runId, step: target.step,
      at: new Date().toISOString(), ...fields }
    saving = true
    $('save-review').disabled = true
    let message
    try {
      await saveReview(record)
      if (drafts.get(target.draftKey) === fields) drafts.delete(target.draftKey)
      if (repository === record.repository) {
        history.push(record)
        latest.set(JSON.stringify([record.table, record.id]), record)
      }
      message = 'Review saved in this browser.'
    } catch (error) {
      message = 'Review could not be saved. ' + error.message
    } finally {
      saving = false
      display()
      const pending = drafts.get(target.draftKey)
      if (context?.draftKey === target.draftKey && (!pending || pending === fields)) {
        $('review-feedback').textContent = message
      }
    }
  }

  return {
    latest,
    load(repo, entries) {
      repository = repo
      history = entries
      latest.clear()
      for (const entry of entries) latest.set(JSON.stringify([entry.table, entry.id]), entry)
    },
    select(selection, runId, step) {
      context = selection && { ...selection, runId, step, draftKey: JSON.stringify([repository, selection.table, selection.id, runId, step]) }
      display()
    }
  }
}
