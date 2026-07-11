import { DHTNode } from '@mesh/engine';

export const DAEMON_DEFAULT_PORT = 4001;
const STATS_INTERVAL_MS = 60 * 1000;

export async function daemonCommand(options = {}, { log = console.log } = {}) {
  const port = options.dhtPort ? Number(options.dhtPort) : DAEMON_DEFAULT_PORT;

  const dhtNode = new DHTNode();
  await dhtNode.listen(port, '0.0.0.0');

  log('mesh DHT bootstrap node is running');
  log(`  node id : ${dhtNode.nodeId}`);
  log(`  UDP port: ${dhtNode.port}`);
  log('');
  log('Point senders at this node:');
  log(`  mesh send <file> --bootstrap <this-server-public-ip>:${dhtNode.port}`);

  const statsTimer = setInterval(() => {
    log(`[${new Date().toISOString()}] known nodes: ${dhtNode.routingTable.size()}, tracked files: ${dhtNode.fileStore.size}`);
  }, STATS_INTERVAL_MS);
  statsTimer.unref?.();

  return {
    dhtNode,
    async stop() {
      clearInterval(statsTimer);
      await dhtNode.close();
    },
  };
}
