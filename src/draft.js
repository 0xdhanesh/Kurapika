const key = 'kurapika-workspace-v1'

export function readDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(key))
    if (typeof draft?.source === 'string' && typeof draft.file === 'string') return draft
  } catch { /* A missing or unreadable draft falls back to the starting example. */ }
  return null
}

export function saveDraft(file, source) {
  try {
    localStorage.setItem(key, JSON.stringify({ file, source }))
    return true
  } catch {
    return false
  }
}
