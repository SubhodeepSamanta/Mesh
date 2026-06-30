import { DHTNode, fileHashToDhtKey } from './dht.js';
import { SwarmManager } from './swarm.js';
import { PeerConnection } from './peer.js';

export const TRANSFER_VERSION = '1.0.0';

export async function downloadFile(fileHash, totalChunks, merkleRoot, dhtNode) {
  const peers = await dhtNode.getPeersForFile(fileHash);

  if (peers.length === 0) {
    throw new Error('No peers found for this file');
  }

  const swarm = new SwarmManager(totalChunks, merkleRoot);
  const connections = new Map();
  const connectionErrors = [];

  for (const peerInfo of peers) {
    const peerId = `${peerInfo.addr}:${peerInfo.port}`;
    try {
      const conn = new PeerConnection(peerInfo.addr, peerInfo.port);
      await conn.connect();
      connections.set(peerId, conn);

      swarm.addPeer(peerId, async (chunkIndex) => {
        const chunkMsg = await conn.requestChunk(chunkIndex);
        swarm.onChunkReceived(peerId, chunkIndex, chunkMsg.chunkData, chunkMsg.chunkHash, chunkMsg.proof);
      });
    } catch (e) {
      connectionErrors.push({ peerId, reason: e.message });
    }
  }

  if (connections.size === 0) {
    const detail = connectionErrors.map(e => `${e.peerId}: ${e.reason}`).join('; ');
    throw new Error(`Could not connect to any peer for this file. Tried ${peers.length} peer(s). ${detail}`);
  }

  if (connectionErrors.length > 0) {
    swarm.emit('connectionWarnings', connectionErrors);
  }

  await new Promise((resolve, reject) => {
    swarm.on('complete', resolve);
    swarm.on('peerFailed', () => {
      if (swarm.peers.size === 0 && !swarm.isComplete()) {
        reject(new Error('All peers failed'));
      }
    });
  });

  for (const conn of connections.values()) conn.close();

  return swarm.assemble();
}

export async function startDownloadSession(fileHash, totalChunks, merkleRoot, bootstrapAddr, bootstrapPort) {
  const dhtNode = new DHTNode();
  await dhtNode.listen();

  if (bootstrapAddr && bootstrapPort) {
    await dhtNode.bootstrap(bootstrapAddr, bootstrapPort);
  }

  try {
    const fileBuffer = await downloadFile(fileHash, totalChunks, merkleRoot, dhtNode);
    return fileBuffer;
  } finally {
    await dhtNode.close();
  }
}