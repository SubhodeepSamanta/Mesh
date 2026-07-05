import { resolve } from 'path';
import { DHTNode, SeedManager, downloadFileByHash } from '@mesh/engine';
import { decodeShareCode, normalizeShareCode } from '../lib/shareCode.js';

export async function receiveCommand(code, options, { onSwarmReady = null } = {}) {
  const { host, port, fileHash } = decodeShareCode(normalizeShareCode(code));

  const dhtNode = new DHTNode();
  await dhtNode.listen(0, '0.0.0.0');

  try {
    await dhtNode.bootstrap(host, port);
  } catch (e) {
    await dhtNode.close();
    throw new Error(`Could not reach sender at ${host}:${port} — ${e.message}`);
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
      const seedEntry = await seedManager.seedFile(result.outputPath, {});
      return { ...result, seeding: true, seedPort: seedEntry.port, dhtNode, seedManager };
    }

    return { ...result, seeding: false, dhtNode, seedManager };
  } finally {
    process.removeListener('SIGINT', onSigint);
    if (!seedManager) await dhtNode.close();
  }
}
