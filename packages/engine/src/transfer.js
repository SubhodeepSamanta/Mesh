import { open, stat } from 'fs/promises';
import { basename, join } from 'path';
import { DHTNode } from './dht.js';
import { SwarmManager } from './swarm.js';
import { connectToPeer } from './net/connect.js';
import { loadResumeState, saveResumeState, deleteResumeState, resumeStateMatches } from './resume.js';

export const TRANSFER_VERSION = '1.0.0';
export const MAX_CONCURRENT_CONNECTIONS = 30;
export const CHECKPOINT_INTERVAL_MS = 2000;

export async function downloadFile({ fileHash, fileSize, totalChunks, chunkSize, merkleRoot, outputPath, dhtNode, signal, onSwarmReady }) {
  if (totalChunks === 0) {
    const emptyHandle = await open(outputPath, 'w');
    await emptyHandle.close();
    return { outputPath, fileSize: 0, totalChunks: 0, status: 'complete' };
  }

  const existingState = await loadResumeState(outputPath);
  const canResume = resumeStateMatches(existingState, { fileHash, totalChunks, chunkSize, merkleRoot, fileSize });
  const alreadyVerified = canResume ? existingState.completedChunks : [];

  const swarm = new SwarmManager(totalChunks, merkleRoot, chunkSize, alreadyVerified);
  if (onSwarmReady) onSwarmReady(swarm, { outputPath, fileSize, totalChunks, chunkSize, merkleRoot });

  if (swarm.isComplete()) {
    await deleteResumeState(outputPath);
    return { outputPath, fileSize, totalChunks, status: 'complete' };
  }

  const peers = await dhtNode.getPeersForFile(fileHash);

  if (peers.length === 0) {
    throw new Error('No peers found for this file');
  }

  const peersToTry = peers.slice(0, MAX_CONCURRENT_CONNECTIONS);
  const connections = new Map();
  const connectionErrors = [];
  const fileHandle = await open(outputPath, canResume ? 'r+' : 'w');

  let checkpointTimer = null;
  const checkpoint = async () => {
    await saveResumeState(outputPath, {
      fileHash, fileSize, totalChunks, chunkSize, merkleRoot,
      completedChunks: swarm.getVerifiedChunkIndices(),
    }).catch(() => {});
  };
  const scheduleCheckpoint = () => {
    if (checkpointTimer) return;
    checkpointTimer = setTimeout(async () => {
      checkpointTimer = null;
      await checkpoint();
    }, CHECKPOINT_INTERVAL_MS);
  };

  try {
    if (!canResume) {
      await fileHandle.truncate(fileSize);
    }

    const connectionAttempts = await Promise.allSettled(
      peersToTry.map(async (peerInfo) => {
        const peerId = `${peerInfo.addr}:${peerInfo.port}`;
        try {
          const { connection, tier } = await connectToPeer(peerInfo, { dhtNode });
          return { peerId, conn: connection, tier };
        } catch (e) {
          return { peerId, error: e };
        }
      })
    );

    for (const result of connectionAttempts) {
      const { peerId, conn, tier, error } = result.value;
      if (conn) {
        connections.set(peerId, conn);
        swarm.emit('peerConnected', { peerId, tier });
        swarm.addPeer(peerId, async (chunkIndex) => {
          const chunkMsg = await conn.requestChunk(chunkIndex);
          const verified = swarm.onChunkReceived(
            peerId, chunkIndex, chunkMsg.chunkData, chunkMsg.chunkHash, chunkMsg.proof
          );
          if (verified) {
            await fileHandle.write(
              chunkMsg.chunkData, 0, chunkMsg.chunkData.length, chunkIndex * chunkSize
            );
            scheduleCheckpoint();
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

    let onAbort = null;

    await new Promise((resolve, reject) => {
      swarm.on('complete', resolve);
      swarm.on('peerFailed', () => {
        if (swarm.peers.size === 0 && !swarm.isComplete()) {
          reject(new Error('All peers failed'));
        }
      });
      if (signal) {
        onAbort = () => { swarm.abort(); resolve(); };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });

    if (signal && onAbort) signal.removeEventListener('abort', onAbort);

    if (signal && signal.aborted) {
      await checkpoint();
      return { outputPath, fileSize, totalChunks, status: 'paused', verifiedChunks: swarm.verifiedCount };
    }

    await deleteResumeState(outputPath);
    return { outputPath, fileSize, totalChunks, status: 'complete' };
  } catch (err) {
    await checkpoint();
    throw err;
  } finally {
    if (checkpointTimer) clearTimeout(checkpointTimer);
    for (const conn of connections.values()) conn.close();
    await fileHandle.close().catch(() => {});
  }
}

export async function downloadFileByHash({ fileHash, outputPath, dhtNode, signal, onSwarmReady }) {
  const peers = await dhtNode.getPeersForFile(fileHash);
  if (peers.length === 0) {
    throw new Error('No peers found for this file');
  }

  let manifest = null;
  const manifestErrors = [];

  for (const peerInfo of peers) {
    let conn = null;
    try {
      ({ connection: conn } = await connectToPeer(peerInfo, { dhtNode }));
      manifest = await conn.waitForMetadata();
      conn.close();
      break;
    } catch (e) {
      manifestErrors.push(`${peerInfo.addr}:${peerInfo.port}: ${e.message}`);
      if (conn) conn.close();
    }
  }

  if (!manifest) {
    throw new Error(`Could not retrieve file metadata from any peer. ${manifestErrors.join('; ')}`);
  }

  const safeFileName = basename(manifest.fileName || 'download');
  let resolvedOutputPath;
  if (!outputPath) {
    resolvedOutputPath = safeFileName;
  } else {
    const targetIsDirectory = await stat(outputPath).then((s) => s.isDirectory()).catch(() => false);
    resolvedOutputPath = targetIsDirectory ? join(outputPath, safeFileName) : outputPath;
  }

  return downloadFile({
    fileHash,
    fileSize: manifest.fileSize,
    totalChunks: manifest.totalChunks,
    chunkSize: manifest.chunkSize,
    merkleRoot: manifest.merkleRoot,
    outputPath: resolvedOutputPath,
    dhtNode,
    signal,
    onSwarmReady,
  });
}
export async function downloadAndSeed({ fileHash, fileSize, totalChunks, chunkSize, merkleRoot, outputPath, dhtNode, signal, seedManager, onSwarmReady }) {
  const result = await downloadFile({ fileHash, fileSize, totalChunks, chunkSize, merkleRoot, outputPath, dhtNode, signal, onSwarmReady });

  if (result.status === 'complete' && seedManager) {
    const seedEntry = await seedManager.seedFile(outputPath, { chunkSize });
    if (seedEntry.merkleRoot !== merkleRoot) {
      throw new Error(
        `Re-seed verification failed: recomputed root (${seedEntry.merkleRoot}) does not match expected root (${merkleRoot}). The downloaded file may not match what was requested.`
      );
    }
    return { ...result, seeding: true, seedPort: seedEntry.port };
  }

  return { ...result, seeding: false };
}
export async function startDownloadSession({ fileHash, fileSize, totalChunks, chunkSize, merkleRoot, outputPath, bootstrapAddr, bootstrapPort, signal, onSwarmReady }) {
  const dhtNode = new DHTNode();
  await dhtNode.listen();

  if (bootstrapAddr && bootstrapPort) {
    await dhtNode.bootstrap(bootstrapAddr, bootstrapPort);
  }

  try {
    return await downloadFile({ fileHash, fileSize, totalChunks, chunkSize, merkleRoot, outputPath, dhtNode, signal, onSwarmReady });
  } finally {
    await dhtNode.close();
  }
}