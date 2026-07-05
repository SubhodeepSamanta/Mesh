import { open } from 'fs/promises';
import { basename } from 'path';
import { indexFile } from './chunker.js';
import { createChunkServer } from './chunkServer.js';
import { TurnClient, generateTurnCredentials, createRelayListener } from './net/turn.js';
import { ReliableDatagramChannel } from './net/reliableDatagram.js';

async function setupRelay(dhtNode, turnConfig, identity, server) {
  const { username, credential } = generateTurnCredentials(turnConfig.secret, identity, turnConfig.credentialTtlSec);
  const turnClient = new TurnClient({ host: turnConfig.host, port: turnConfig.port, username, credential });
  const { relayedAddress } = await turnClient.allocate();

  const relayListener = createRelayListener(turnClient, (addr, port, virtualChannel) => {
    const reliableChannel = new ReliableDatagramChannel(virtualChannel);
    server.handleRelayConnection(reliableChannel);
  });

  const permissionHandler = (addr, port) => turnClient.createPermission(addr, port);
  dhtNode.addRelayPermissionHandler(permissionHandler);

  return {
    relay: { addr: relayedAddress.address, port: relayedAddress.port },
    turnClient,
    permissionHandler,
    relayListener,
  };
}

export class SeedManager {
  constructor(dhtNode) {
    this.dhtNode = dhtNode;
    this.seeds = new Map();
  }

async seedFile(filePath, { fileName, chunkSize: chunkSizeOverride, host = '0.0.0.0', port: portOverride = 0, turnConfig = null } = {}) {
    const { fileSize, hashes, tree, merkleRoot, totalChunks, chunkSize } = await indexFile(filePath, chunkSizeOverride);
    const existing = this.seeds.get(merkleRoot);
    if (existing) return existing;

    const fileHandle = await open(filePath, 'r');
    const server = createChunkServer({
      fileHandle, hashes, tree, merkleRoot,
      fileName: fileName || basename(filePath),
      fileSize, totalChunks, chunkSize,
    });

    const port = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(portOverride, host, () => {
        server.removeListener('error', reject);
        resolve(server.address().port);
      });
    });

    let relay = null;
    let turnClient = null;
    let permissionHandler = null;
    let relayListener = null;
    if (turnConfig) {
      ({ relay, turnClient, permissionHandler, relayListener } = await setupRelay(this.dhtNode, turnConfig, `${this.dhtNode.nodeId}:${merkleRoot}`, server));
    }

    await this.dhtNode.announceFile(merkleRoot, port, relay);

    const entry = { server, fileHandle, port, merkleRoot, filePath, totalChunks, fileSize, chunkSize, turnClient, permissionHandler, relayListener };
    this.seeds.set(merkleRoot, entry);
    return entry;
  }

  async stopSeeding(merkleRoot) {
    const entry = this.seeds.get(merkleRoot);
    if (!entry) return;
    if (entry.permissionHandler) this.dhtNode.removeRelayPermissionHandler(entry.permissionHandler);
    if (entry.relayListener) entry.relayListener.close();
    if (entry.turnClient) entry.turnClient.close();
    await new Promise((resolve) => entry.server.close(resolve));
    await entry.fileHandle.close().catch(() => {});
    this.seeds.delete(merkleRoot);
  }

  async stopAll() {
    for (const merkleRoot of [...this.seeds.keys()]) {
      await this.stopSeeding(merkleRoot);
    }
  }

  isSeeding(merkleRoot) {
    return this.seeds.has(merkleRoot);
  }

  getSeedingList() {
    return [...this.seeds.values()].map(({ merkleRoot, filePath, port, totalChunks, fileSize }) => ({
      merkleRoot, filePath, port, totalChunks, fileSize,
    }));
  }
}