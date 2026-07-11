import { resolve } from 'path';
import { DHTNode, SeedManager, downloadFileByHash } from '@mesh/engine';
import { decodeShareCode, normalizeShareCode } from '../lib/shareCode.js';
import { resolveCandidates, makeTransferCandidateResolver } from '../lib/network.js';

export async function receiveCommand(code, options, { onSwarmReady = null } = {}) {
  const { candidates, fileHash } = decodeShareCode(normalizeShareCode(code));

  const dhtNode = new DHTNode();
  await dhtNode.listen(0, '0.0.0.0');

  // stays false unless we end up seeding, in which case the DHT node must
  // outlive this function
  let keepDhtOpen = false;

  try {
    try {
      await dhtNode.bootstrap(candidates.map((c) => ({ host: c.host, port: c.port })));
    } catch (e) {
      const tried = candidates.map((c) => `${c.host}:${c.port}`).join(', ');
      throw new Error(`Could not reach sender at any of [${tried}] — ${e.message}`);
    }

    const outputPath = options.out ? resolve(options.out) : undefined;
    const controller = new AbortController();
    const onSigint = () => controller.abort();
    process.on('SIGINT', onSigint);

    const seedManager = options.seed ? new SeedManager(dhtNode) : null;

    try {
      const result = await downloadFileByHash({
        fileHash,
        outputPath,
        dhtNode,
        signal: controller.signal,
        onSwarmReady,
      });

      if (result.status === 'complete' && seedManager) {
        const skipUpnp = options.upnp === false;
        const skipStun = options.stun === false;

        const dhtResolved = await resolveCandidates({
          localPort: dhtNode.port,
          protocol: 'UDP',
          description: 'mesh-dht',
          skipUpnp,
          skipStun,
          stunSocket: dhtNode.socket,
        }).catch(() => null);
        if (dhtResolved) dhtNode.publicAddress = dhtResolved.primaryHost;

        const seedEntry = await seedManager.seedFile(result.outputPath, {
          resolveTransferCandidates: makeTransferCandidateResolver({
            skipUpnp,
            publicHost: dhtResolved ? dhtResolved.primaryHost : null,
          }),
        });
        keepDhtOpen = true;
        return { ...result, seeding: true, seedPort: seedEntry.port, dhtNode, seedManager };
      }

      return { ...result, seeding: false, dhtNode, seedManager };
    } finally {
      process.removeListener('SIGINT', onSigint);
    }
  } finally {
    if (!keepDhtOpen) await dhtNode.close();
  }
}
