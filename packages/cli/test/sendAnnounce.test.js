import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DHTNode } from '@mesh/engine';
import { sendCommand } from '../src/commands/send.js';
import { decodeShareCode } from '../src/lib/shareCode.js';

describe('sendCommand announced address', () => {
  test('announces the detected/explicit public host as a candidate, not just the 0.0.0.0 bind default', { timeout: 15000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mesh-announce-test-'));
    const filePath = join(dir, 'f.bin');
    await writeFile(filePath, Buffer.from('announce address regression test'));

    const session = await sendCommand(filePath, { publicIp: '203.0.113.77', upnp: false, stun: false }, { log: () => {} });

    try {
      assert.equal(session.dhtNode.publicAddress, '203.0.113.77');

      const { candidates, fileHash } = decodeShareCode(session.summary.shareCode);
      assert.ok(candidates.some((c) => c.host === '203.0.113.77'), 'share code candidates should include the explicit public host');
      const dhtCandidate = candidates.find((c) => c.host === '203.0.113.77');
      assert.equal(dhtCandidate.port, session.dhtNode.port);

      const finder = new DHTNode();
      await finder.listen();
      finder.routingTable.addPeer({ id: session.dhtNode.nodeId, addr: '127.0.0.1', port: session.dhtNode.port });

      const peers = await finder.getPeersForFile(fileHash);
      const peer = peers.find((p) => p.port === session.summary.transferPort);

      assert.ok(peer, 'expected the sender to announce a peer entry for its own file');
      assert.equal(peer.dhtAddr, '203.0.113.77');
      assert.ok(
        peer.candidates.some((c) => c.addr === '203.0.113.77' && c.port === session.summary.transferPort),
        'transfer candidates should include the explicit public host at the real chunk-server port'
      );

      await finder.close();
    } finally {
      await session.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
