import Badge from './shared/Badge.jsx'

function shortenPeerId(id) {
  if (!id) return '\u2014'
  return id.length > 16 ? `${id.slice(0, 16)}\u2026` : id
}

export default function PeerList({ peerStats = [] }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium uppercase tracking-widest text-[var(--txt-secondary)]">
          Active Peers
        </span>
        <span className="text-sm text-[var(--txt-secondary)]">{peerStats.length}</span>
      </div>
      <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
        {peerStats.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--txt-secondary)]">No peers connected</p>
        ) : (
          peerStats.map((peer) => {
            const connected = !peer.failed && (peer.consecutiveFailures || 0) < 3
            return (
              <div
                key={peer.id}
                className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
              >
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`}
                />
                <span className="min-w-0 flex-1 font-mono text-[var(--txt-primary)] truncate">
                  {shortenPeerId(peer.id)}
                </span>
                <span className="shrink-0 text-xs text-[var(--txt-secondary)]">
                  {peer.chunksServed || 0} chunks
                </span>
                {peer.failed && (
                  <Badge color="red" dot={false}>FAILED</Badge>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
