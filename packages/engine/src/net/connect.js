import dgram from 'dgram';
import { PeerConnection } from '../peer.js';
import { ReliableDatagramChannel } from './reliableDatagram.js';
import { TurnClient } from './turn.js';

export const DIRECT_CONNECT_TIMEOUT_MS = 4000;
export const RELAY_HELLO_TIMEOUT_MS = 4000;
// Short on purpose: this doubles as a NAT keepalive for the receiver's TURN
// control socket — idle UDP mappings on home/CGNAT routers die in ~30s, which
// would silently cut the relay mid-transfer.
export const RELAY_REFRESH_INTERVAL_MS = 15 * 1000;

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

function candidatesFor(peerInfo) {
  return Array.isArray(peerInfo.candidates) && peerInfo.candidates.length > 0
    ? peerInfo.candidates
    : [{ addr: peerInfo.addr, port: peerInfo.port }];
}

async function connectDirect(candidates, directTimeoutMs) {
  const attempts = candidates.map(async (c) => {
    const conn = new PeerConnection(c.addr, c.port);
    try {
      await withTimeout(conn.connect(), directTimeoutMs, `Direct connection to ${c.addr}:${c.port} timed out`);
      return conn;
    } catch (err) {
      conn.close();
      throw err;
    }
  });

  try {
    const winner = await Promise.any(attempts);
    for (const attempt of attempts) {
      attempt.then((conn) => { if (conn !== winner) conn.close(); }).catch(() => {});
    }
    return winner;
  } catch (aggregateError) {
    const reasons = (aggregateError.errors || [aggregateError])
      .map((e, i) => `${candidates[i]?.addr}:${candidates[i]?.port}: ${e.message}`)
      .join('; ');
    throw new Error(`All ${candidates.length} direct candidate(s) failed. ${reasons}`);
  }
}

// Preferred relay path: open our own allocation on the seeder's TURN server
// using the short-lived credentials it published with the announce. Both ends
// then talk relay-to-relay, which traverses any NAT type on either side.
async function connectViaOwnAllocation(peerInfo) {
  const { relay } = peerInfo;
  const turnClient = new TurnClient({
    host: relay.turn.host,
    port: relay.turn.port,
    username: relay.turn.username,
    credential: relay.turn.credential,
  });

  let refreshTimer = null;
  try {
    await turnClient.allocate();
    await turnClient.createPermission(relay.addr, relay.port);

    refreshTimer = setInterval(() => {
      turnClient.refresh().catch(() => {});
      turnClient.createPermission(relay.addr, relay.port).catch(() => {});
    }, RELAY_REFRESH_INTERVAL_MS);
    refreshTimer.unref?.();

    const listeners = new Set();
    const onData = (fromAddress, fromPort, data) => {
      if (fromAddress === relay.addr && fromPort === relay.port) {
        for (const cb of listeners) cb(data);
      }
    };

    const rawChannel = {
      send: (buffer) => turnClient.send(relay.addr, relay.port, buffer),
      on: (event, cb) => { if (event === 'message') listeners.add(cb); },
      removeListener: (event, cb) => listeners.delete(cb),
      close: () => {
        if (refreshTimer) clearInterval(refreshTimer);
        turnClient.removeListener('data', onData);
        turnClient.close();
      },
    };
    turnClient.on('data', onData);

    const reliableChannel = new ReliableDatagramChannel(rawChannel);
    const relayed = new PeerConnection(peerInfo.addr, peerInfo.port, { transport: reliableChannel });
    await relayed.connect();
    return { connection: relayed, tier: 'relay' };
  } catch (e) {
    if (refreshTimer) clearInterval(refreshTimer);
    turnClient.close();
    throw e;
  }
}

// Legacy relay path: ask the seeder (via a direct DHT RELAY_HELLO) to open a
// TURN permission for our public address, then dial its relayed address with a
// raw socket. Only works when the seeder's DHT port is directly reachable.
async function connectViaRelayHello(peerInfo, dhtNode) {
  await dhtNode.requestRelayPermission(peerInfo.dhtAddr, peerInfo.dhtPort, { timeoutMs: RELAY_HELLO_TIMEOUT_MS });

  const socket = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, () => {
      socket.removeListener('error', reject);
      resolve();
    });
  });

  const rawChannel = {
    send: (buffer) => socket.send(buffer, peerInfo.relay.port, peerInfo.relay.addr),
    on: (event, cb) => {
      if (event === 'message') socket.on('message', (msg) => cb(msg));
    },
    removeListener: (event, cb) => socket.removeListener('message', cb),
    close: () => socket.close(),
  };

  const reliableChannel = new ReliableDatagramChannel(rawChannel);
  const relayed = new PeerConnection(peerInfo.addr, peerInfo.port, { transport: reliableChannel });
  await relayed.connect();
  return { connection: relayed, tier: 'relay' };
}

async function connectViaRelay(peerInfo, dhtNode, directError) {
  const errors = [];

  if (peerInfo.relay.turn && peerInfo.relay.turn.host) {
    try {
      return await connectViaOwnAllocation(peerInfo);
    } catch (e) {
      errors.push(`turn allocation: ${e.message}`);
    }
  }

  if (peerInfo.dhtAddr && peerInfo.dhtPort && dhtNode) {
    try {
      return await connectViaRelayHello(peerInfo, dhtNode);
    } catch (e) {
      errors.push(`relay hello: ${e.message}`);
    }
  }

  if (errors.length === 0) errors.push('no usable relay path (missing TURN credentials and DHT address)');
  throw new Error(`Direct connection failed (${directError.message}); relay fallback also failed: ${errors.join('; ')}`);
}

export async function connectToPeer(peerInfo, { dhtNode = null, directTimeoutMs = DIRECT_CONNECT_TIMEOUT_MS } = {}) {
  const candidates = candidatesFor(peerInfo);

  try {
    const connection = await connectDirect(candidates, directTimeoutMs);
    return { connection, tier: 'direct' };
  } catch (directError) {
    if (!peerInfo.relay) throw directError;
    return connectViaRelay(peerInfo, dhtNode, directError);
  }
}
