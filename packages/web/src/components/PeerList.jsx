import Badge from './shared/Badge.jsx'

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
            const isSeeder = (peer.chunksServed || 0) > 0
            return (
              <div
                key={peer.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-[var(--success)]' : 'bg-[var(--error)]'}`}
                  title={connected ? 'Connected' : 'Disconnected'}
                />
                <span className="font-mono text-[var(--txt-primary)] break-all">
                  {peer.id}
                </span>
                <Badge color={isSeeder ? 'amber' : 'gray'} dot={false}>
                  {isSeeder ? 'SEED' : 'LEECH'}
                </Badge>
                <span className="text-xs text-[var(--txt-secondary)] whitespace-nowrap">
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
