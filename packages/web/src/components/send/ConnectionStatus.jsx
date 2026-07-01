const LABELS = {
  idle: 'Idle',
  'waiting-for-peer': 'Waiting for receiver…',
  'file-offered': 'Sending file info…',
  transferring: 'Transferring…',
  complete: 'Complete',
  paused: 'Paused',
  error: 'Error',
}

export default function ConnectionStatus({ status }) {
  const dotColor =
    status === 'transferring' ? 'bg-green-500 animate-pulse'
    : status === 'error' ? 'bg-red-500'
    : status === 'complete' ? 'bg-green-500'
    : 'bg-amber-500'

  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-black/5 px-4 py-2 text-sm dark:bg-white/10">
      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
      {LABELS[status] || status}
    </div>
  )
}