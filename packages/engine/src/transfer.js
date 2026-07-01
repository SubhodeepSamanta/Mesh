import { open, unlink } from 'fs/promises';
import { DHTNode } from './dht.js';
import { SwarmManager } from './swarm.js';
import { PeerConnection } from './peer.js';

export const TRANSFER_VERSION = '1.0.0';
export const MAX_CONCURRENT_CONNECTIONS = 30;

export async function downloadFile({ fileHash, fileSize, totalChunks, chunkSize, merkleRoot, outputPath, dhtNode }) {
  if (totalChunks === 0) {
    const emptyHandle = await open(outputPath, 'w');
    await emptyHandle.close();
    return { outputPath, fileSize: 0, totalChunks: 0 };
  }

  const peers = await dhtNode.getPeersForFile(fileHash);

  if (peers.length === 0) {
    throw new Error('No peers found for this file');
  }

  const peersToTry = peers.slice(0, MAX_CONCURRENT_CONNECTIONS);

  const swarm = new SwarmManager(totalChunks, merkleRoot, chunkSize);
  const connections = new Map();
  const connectionErrors = [];
  const fileHandle = await open(outputPath, 'w');
  let succeeded = false;

  try {
    await fileHandle.truncate(fileSize);

    const connectionAttempts = await Promise.allSettled(
      peersToTry.map(async (peerInfo) => {
        const peerId = `${peerInfo.addr}:${peerInfo.port}`;
        try {
          const conn = new PeerConnection(peerInfo.addr, peerInfo.port);
          await conn.connect();
          return { peerId, conn };
        } catch (e) {
          return { peerId, error: e };
        }
      })
    );

    for (const result of connectionAttempts) {
      const { peerId, conn, error } = result.value;
      if (conn) {
        connections.set(peerId, conn);
        swarm.addPeer(peerId, async (chunkIndex) => {
          const chunkMsg = await conn.requestChunk(chunkIndex);
          const verified = swarm.onChunkReceived(
            peerId, chunkIndex, chunkMsg.chunkData, chunkMsg.chunkHash, chunkMsg.proof
          );
          if (verified) {
            await fileHandle.write(
              chunkMsg.chunkData, 0, chunkMsg.chunkData.length, chunkIndex * chunkSize
            );
          }
        });
      } else {
        connectionErrors.push({ peerId, reason: error.message });
      }
    }

    if (connections.size === 0) {
      const detail = connectionErrors.map(e => `${e.peerId}: ${e.reason}`).join('; ');
      throw new Error(`Could not connect to any peer for this file. Tried ${peersToTry.length} of ${peers.length} discovered peer(s). ${detail}`);
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

    succeeded = true;
    return { outputPath, fileSize, totalChunks };
  } finally {
    for (const conn of connections.values()) conn.close();
    await fileHandle.close().catch(() => {});
    if (!succeeded) {
      await unlink(outputPath).catch(() => {});
    }
  }
}

export async function startDownloadSession({ fileHash, fileSize, totalChunks, chunkSize, merkleRoot, outputPath, bootstrapAddr, bootstrapPort }) {
  const dhtNode = new DHTNode();
  await dhtNode.listen();

  if (bootstrapAddr && bootstrapPort) {
    await dhtNode.bootstrap(bootstrapAddr, bootstrapPort);
  }

  try {
    return await downloadFile({ fileHash, fileSize, totalChunks, chunkSize, merkleRoot, outputPath, dhtNode });
  } finally {
    await dhtNode.close();
  }
}