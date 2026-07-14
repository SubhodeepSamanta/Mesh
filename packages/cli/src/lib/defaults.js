// The project's public rendezvous infrastructure. `mesh send` works with zero
// flags because these are baked in — the same way BitTorrent clients ship with
// default DHT bootstrap routers. Point at your own deployment with
// --bootstrap / --turn-host / --turn-secret or the MESH_* env vars, or opt out
// entirely with --no-bootstrap / --no-turn.
export const DEFAULT_BOOTSTRAP = '172.197.208.101:4001';
export const DEFAULT_TURN_API = 'http://172.197.208.101:8080/turn';

// Ask the signaling server for time-limited TURN credentials (HMAC over the
// server-side secret) instead of shipping the secret inside this package.
export async function fetchTurnCredentials(url = DEFAULT_TURN_API, { timeoutMs = 5000 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`TURN credential endpoint returned HTTP ${res.status}`);
  const body = await res.json();
  const servers = Array.isArray(body.iceServers) ? body.iceServers : [];
  const turn = servers.find((s) => typeof s.urls === 'string' && s.urls.startsWith('turn:') && s.username && s.credential);
  if (!turn) throw new Error('no TURN credentials in endpoint response');
  const match = turn.urls.match(/^turn:([^:?]+)(?::(\d+))?/);
  if (!match) throw new Error(`unparseable TURN url: ${turn.urls}`);
  return { host: match[1], port: Number(match[2] || 3478), username: turn.username, credential: turn.credential };
}
