import { open, stat } from 'fs/promises';
import { basename, join } from 'path';
import { DHTNode } from './dht.js';
import { SwarmManager } from './swarm.js';
import { connectToPeer } from './net/connect.js';
import { loadResumeState, saveResumeState, deleteResumeState, resumeStateMatches } from './resume.js';

export const TRANSFER_VERSION = '1.0.0';
export const MAX_CONCURRENT_CONNECTIONS = 30;
export const CHECKPOINT_INTERVAL_MS = 2000;
// Losing every peer mid-transfer is usually a transient network stall (mobile
// hotspots especially), not a dead seeder — seeders re-announce every 25s, so
// re-discovering and reconnecting resumes from the exact chunk we stopped at.
export const MAX_TRANSFER_ATTEMPTS = 4;
export const RETRY_DELAY_MS = 5000;

export async function downloadFile({ fileHash, fileSize, totalChunks, chunkSize, merkleRoot, outputPath, dhtNode, signal, onSwarmReady, maxAttempts = MAX_TRANSFER_ATTEMPTS, retryDelayMs = RETRY_DELAY_MS }) {
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

  const connections = new Map();
  const pendingWrites = new Set();
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

  const connectToPeerList = async (peerList) => {
    const peersToTry = peerList.slice(0, MAX_CONCURRENT_CONNECTIONS);
    const connectionErrors = [];

    const connectionAttempts = await Promise.allSettled(
      peersToTry.map(async (peerInfo) => {
        const peerId = `${peerInfo.addr}:${peerInfo.port}`;
        if (connections.has(peerId)) return { peerId, skipped: true };
        try {
          const { connection, tier } = await connectToPeer(peerInfo, { dhtNode });
          return { peerId, conn: connection, tier };
        } catch (e) {
          return { peerId, error: e };
        }
      })
    );

    for (const result of connectionAttempts) {
      const { peerId, conn, tier, error, skipped } = result.value;
      if (skipped) continue;
      if (conn) {
        connections.set(peerId, conn);
        swarm.emit('peerConnected', { peerId, tier });
        swarm.addPeer(peerId, async (chunkIndex) => {
          const chunkMsg = await conn.requestChunk(chunkIndex);
          const verified = swarm.onChunkReceived(
            peerId, chunkIndex, chunkMsg.chunkData, chunkMsg.chunkHash, chunkMsg.proof
          );
          if (verified) {
            const writePromise = fileHandle.write(
              chunkMsg.chunkData, 0, chunkMsg.chunkData.length, chunkIndex * chunkSize
            );
            pendingWrites.add(writePromise);
            try {
              await writePromise;
            } finally {
              pendingWrites.delete(writePromise);
            }
            scheduleCheckpoint();
          }
        });
      } else {
        connectionErrors.push({ peerId, reason: error.message });
      }
    }

    return { tried: peersToTry.length, connectionErrors };
  };

  // Resolves 'complete' | 'failed' (every peer evicted) | 'aborted', with all
  // listeners detached — attempts must not leak handlers onto the swarm.
  const waitForOutcome = () => new Promise((resolve) => {
    const settle = (outcome) => {
      swarm.removeListener('complete', onComplete);
      swarm.removeListener('peerFailed', onPeerFailed);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const onComplete = () => settle('complete');
    const onPeerFailed = () => {
      if (swarm.peers.size === 0 && !swarm.isComplete()) settle('failed');
    };
    const onAbort = () => { swarm.abort(); settle('aborted'); };

    swarm.on('complete', onComplete);
    swarm.on('peerFailed', onPeerFailed);
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // Guard against events that fired before we attached: a very fast peer
    // (or a very fast eviction) must not leave this promise hanging.
    if (swarm.isComplete()) settle('complete');
    else if (swarm.peers.size === 0) settle('failed');
  });

  try {
    if (!canResume) {
      await fileHandle.truncate(fileSize);
    }

    let peerList = peers;
    for (let attempt = 1; ; attempt++) {
      const { tried, connectionErrors } = await connectToPeerList(peerList);

      if (connections.size === 0 && attempt >= maxAttempts) {
        const detail = connectionErrors.map(e => `${e.peerId}: ${e.reason}`).join('; ');
        throw new Error(`Could not connect to any peer for this file. Tried ${tried} of ${peerList.length} discovered peer(s). ${detail}`);
      }

      if (connectionErrors.length > 0) {
        swarm.emit('connectionWarnings', connectionErrors);
      }

      const outcome = connections.size > 0 ? await waitForOutcome() : 'failed';
      if (outcome === 'complete' || outcome === 'aborted') break;

      // 'failed': every connection died — almost always a transient network
      // stall, not a stopped seeder. Progress is preserved in the swarm, so
      // reconnect and continue from the next unverified chunk.
      for (const conn of connections.values()) conn.close();
      connections.clear();

      if (attempt >= maxAttempts) {
        throw new Error(`All peers failed (gave up after ${attempt} attempts; ${swarm.verifiedCount}/${totalChunks} chunks verified — re-run the same command to resume)`);
      }

      swarm.emit('retrying', { attempt: attempt + 1, verified: swarm.verifiedCount, total: totalChunks });
      await checkpoint();
      await new Promise((resolve) => {
        const t = setTimeout(resolve, retryDelayMs);
        if (signal) signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
      });
      if (signal && signal.aborted) { swarm.abort(); break; }

      peerList = await dhtNode.getPeersForFile(fileHash).catch(() => []);
      if (peerList.length === 0) peerList = peers;
    }

    // the swarm 'complete' event fires before the last chunk write settles
    if (pendingWrites.size > 0) await Promise.allSettled([...pendingWrites]);

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