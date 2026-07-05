import dgram from 'dgram';
import { PeerConnection } from '../peer.js';
import { ReliableDatagramChannel } from './reliableDatagram.js';

export const DIRECT_CONNECT_TIMEOUT_MS = 4000;
export const RELAY_HELLO_TIMEOUT_MS = 4000;

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

async function connectViaRelay(peerInfo, dhtNode, directError) {
  try {
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
  } catch (relayError) {
    throw new Error(`Direct connection failed (${directError.message}); relay fallback also failed: ${relayError.message}`);
  }
}

export async function connectToPeer(peerInfo, { dhtNode = null, directTimeoutMs = DIRECT_CONNECT_TIMEOUT_MS } = {}) {
  const direct = new PeerConnection(peerInfo.addr, peerInfo.port);
  try {
    await withTimeout(direct.connect(), directTimeoutMs, 'Direct connection timed out');
    return { connection: direct, tier: 'direct' };
  } catch (directError) {
    direct.close();
    if (!peerInfo.relay || !peerInfo.dhtAddr || !peerInfo.dhtPort || !dhtNode) throw directError;
    return connectViaRelay(peerInfo, dhtNode, directError);
  }
}
