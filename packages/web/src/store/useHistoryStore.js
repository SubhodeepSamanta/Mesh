const KEY = 'mesh-history'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function save(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {}
}

export function addHistoryEntry(entry) {
  const entries = load()
  entries.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: Date.now(),
    ...entry,
  })
  if (entries.length > 50) entries.length = 50
  save(entries)
  return entries
}

export function getHistory() {
  return load()
}

export function clearHistory() {
  save([])
  return []
}

export function removeHistoryEntry(id) {
  const entries = load().filter(e => e.id !== id)
  save(entries)
  return entries
}
