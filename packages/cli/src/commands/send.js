import { resolve, basename } from 'path';
import { stat } from 'fs/promises';
import { DHTNode, SeedManager } from '@mesh/engine';
import { resolvePublicEndpoint } from '../lib/network.js';
import { encodeShareCode, formatShareCode } from '../lib/shareCode.js';

export async function sendCommand(filePath, options, { log = console.log, onSeedReady = null } = {}) {
  const absolutePath = resolve(filePath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new Error(`Not a file: ${absolutePath}`);
  }

  const dhtNode = new DHTNode();
  await dhtNode.listen(options.dhtPort ? Number(options.dhtPort) : 0, '0.0.0.0');

  if (options.bootstrap) {
    const [bootstrapHost, bootstrapPortStr] = options.bootstrap.split(':');
    try {
      await dhtNode.bootstrap(bootstrapHost, Number(bootstrapPortStr));
    } catch (e) {
      log(`Warning: could not bootstrap into ${options.bootstrap}: ${e.message}`);
    }
  }

  const seedManager = new SeedManager(dhtNode);

  const turnHost = options.turnHost || process.env.MESH_TURN_HOST;
  const turnSecret = options.turnSecret || process.env.MESH_TURN_SECRET;
  const turnPort = options.turnPort || process.env.MESH_TURN_PORT || 3478;

  const turnConfig = turnHost && turnSecret
    ? { host: turnHost, port: Number(turnPort), secret: turnSecret }
    : null;

  const seedEntry = await seedManager.seedFile(absolutePath, {
    fileName: basename(absolutePath),
    port: options.port ? Number(options.port) : 0,
    turnConfig,
  });

  const dhtEndpoint = await resolvePublicEndpoint({
    localPort: dhtNode.port,
    protocol: 'UDP',
    description: 'mesh-dht',
    explicitHost: options.publicIp || process.env.MESH_PUBLIC_IP || null,
    skipUpnp: Boolean(options.noUpnp),
    skipStun: Boolean(options.noStun),
  });

  if (!options.noUpnp) {
    await resolvePublicEndpoint({
      localPort: seedEntry.port,
      protocol: 'TCP',
      description: 'mesh-transfer',
      explicitHost: options.publicIp || process.env.MESH_PUBLIC_IP || null,
      skipStun: true,
    }).catch(() => {});
  }

  const shareCode = encodeShareCode({
    fileHash: seedEntry.merkleRoot,
    host: dhtEndpoint.host,
    port: dhtNode.port,
  });

  const summary = {
    filePath: absolutePath,
    fileName: basename(absolutePath),
    fileSize: seedEntry.fileSize,
    totalChunks: seedEntry.totalChunks,
    merkleRoot: seedEntry.merkleRoot,
    shareCode,
    shareCodeFormatted: formatShareCode(shareCode),
    connectivity: dhtEndpoint.method,
    dhtPort: dhtNode.port,
    transferPort: seedEntry.port,
    turnConfigured: Boolean(turnConfig),
  };

  if (onSeedReady) onSeedReady(summary);

  return {
    summary,
    dhtNode,
    seedManager,
    async stop() {
      await seedManager.stopAll();
      await dhtNode.close();
    },
  };
}
