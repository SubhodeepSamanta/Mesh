import { resolve, basename } from 'path';
import { stat } from 'fs/promises';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { DHTNode, SeedManager } from '@mesh/engine';
import { resolveCandidates, makeTransferCandidateResolver } from '../lib/network.js';
import { encodeShareCode, formatShareCode } from '../lib/shareCode.js';
import { DEFAULT_BOOTSTRAP, DEFAULT_TURN_API, fetchTurnCredentials } from '../lib/defaults.js';

async function resolveBootstrapTarget(hostPort) {
  const [host, portStr] = hostPort.split(':');
  const port = Number(portStr);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --bootstrap value, expected host:port, got: ${hostPort}`);
  }
  const ip = isIP(host) === 4 ? host : (await lookup(host, { family: 4 })).address;
  return { host: ip, port };
}

export async function sendCommand(filePath, options, { log = console.log, onSeedReady = null } = {}) {
  const absolutePath = resolve(filePath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new Error(`Not a file: ${absolutePath}`);
  }

  const dhtNode = new DHTNode();
  await dhtNode.listen(options.dhtPort ? Number(options.dhtPort) : 0, '0.0.0.0');

  // Default to the project's public bootstrap node so `mesh send <file>` works
  // with no flags; --bootstrap overrides it, --no-bootstrap opts out.
  const bootstrapSpec = options.bootstrap === false
    ? null
    : (typeof options.bootstrap === 'string' ? options.bootstrap : (process.env.MESH_BOOTSTRAP || DEFAULT_BOOTSTRAP));

  let bootstrapTarget = null;
  if (bootstrapSpec) {
    try {
      bootstrapTarget = await resolveBootstrapTarget(bootstrapSpec);
      await dhtNode.bootstrap(bootstrapTarget.host, bootstrapTarget.port);
    } catch (e) {
      bootstrapTarget = null;
      log(`Warning: could not bootstrap into ${bootstrapSpec}: ${e.message}`);
    }
  }

  const explicitHost = options.publicIp || process.env.MESH_PUBLIC_IP || null;
  const skipUpnp = options.upnp === false;
  const skipStun = options.stun === false;

  const dhtResolved = await resolveCandidates({
    localPort: dhtNode.port,
    protocol: 'UDP',
    description: 'mesh-dht',
    explicitHost,
    skipUpnp,
    skipStun,
    stunSocket: dhtNode.socket,
  });

  dhtNode.publicAddress = dhtResolved.primaryHost;

  const seedManager = new SeedManager(dhtNode);

  const turnHost = options.turnHost || process.env.MESH_TURN_HOST;
  const turnSecret = options.turnSecret || process.env.MESH_TURN_SECRET;
  const turnPort = options.turnPort || process.env.MESH_TURN_PORT || 3478;

  // TURN relay tier: an explicit host+secret wins; otherwise fetch time-limited
  // credentials from the credential endpoint so no flags (and no secret) are
  // needed. --no-turn opts out of the relay tier entirely.
  let turnConfig = null;
  if (options.turn !== false) {
    if (turnHost && turnSecret) {
      turnConfig = { host: turnHost, port: Number(turnPort), secret: turnSecret };
    } else {
      try {
        turnConfig = await fetchTurnCredentials(process.env.MESH_TURN_API || DEFAULT_TURN_API);
      } catch (e) {
        log(`Warning: TURN relay unavailable (${e.message}) — continuing with direct connectivity only`);
      }
    }
  }

  const seedEntry = await seedManager.seedFile(absolutePath, {
    fileName: basename(absolutePath),
    port: options.port ? Number(options.port) : 0,
    turnConfig,
    resolveTransferCandidates: makeTransferCandidateResolver({
      explicitHost,
      skipUpnp,
      publicHost: dhtResolved.primaryHost,
    }),
  });

  // The receiver bootstraps its DHT node via these candidates. If we joined an
  // existing DHT (e.g. a public bootstrap node), include it too — it is often
  // the only address reachable when this machine is behind NAT.
  const shareCodeCandidates = [
    ...(bootstrapTarget ? [{ host: bootstrapTarget.host, port: bootstrapTarget.port }] : []),
    ...dhtResolved.candidates.map((c) => ({ host: c.addr, port: c.port })),
  ];

  const shareCode = encodeShareCode({
    fileHash: seedEntry.merkleRoot,
    candidates: shareCodeCandidates,
  });

  const summary = {
    filePath: absolutePath,
    fileName: basename(absolutePath),
    fileSize: seedEntry.fileSize,
    totalChunks: seedEntry.totalChunks,
    merkleRoot: seedEntry.merkleRoot,
    shareCode,
    shareCodeFormatted: formatShareCode(shareCode),
    connectivity: dhtResolved.method,
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
