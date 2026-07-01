export function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatSpeed(mbps) {
  if (mbps < 0.1) return '< 0.1 MB/s'
  return `${mbps.toFixed(1)} MB/s`
}

export function formatDuration(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

export function formatEta(bytesRemaining, mbpsCurrent) {
  if (!mbpsCurrent || mbpsCurrent <= 0) return '—'
  const secondsRemaining = bytesRemaining / (mbpsCurrent * 1024 * 1024)
  return formatDuration(secondsRemaining)
}