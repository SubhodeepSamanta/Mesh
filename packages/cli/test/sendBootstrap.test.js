import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DHTNode } from '@mesh/engine';
import { sendCommand } from '../src/commands/send.js';
import { decodeShareCode } from '../src/lib/shareCode.js';
import { makeTransferCandidateResolver } from '../src/lib/network.js';

describe('sendCommand with a bootstrap node', () => {
  test('includes the bootstrap node in the share code and announces the file to it, so a receiver that can only reach the bootstrap node still finds the sender', { timeout: 20000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mesh-bootstrap-test-'));
    const filePath = join(dir, 'f.bin');
    await writeFile(filePath, Buffer.from('bootstrap share-code regression test'));

    const bootstrapNode = new DHTNode();
    await bootstrapNode.listen(0, '127.0.0.1');

    const session = await sendCommand(
      filePath,
      { bootstrap: `127.0.0.1:${bootstrapNode.port}`, publicIp: '203.0.113.99', upnp: false, stun: false },
      { log: () => {} }
    );

    try {
      const { candidates, fileHash } = decodeShareCode(session.summary.shareCode);
      assert.ok(
        candidates.some((c) => c.host === '127.0.0.1' && c.port === bootstrapNode.port),
        'share code should contain the bootstrap node as a DHT candidate'
      );

      // a receiver that can only reach the bootstrap node (sender is NATed)
      const receiver = new DHTNode();
      await receiver.listen(0, '127.0.0.1');
      await receiver.bootstrap([{ host: '127.0.0.1', port: bootstrapNode.port }]);

      const peers = await receiver.getPeersForFile(fileHash);
      const peer = peers.find((p) => p.port === session.summary.transferPort);
      assert.ok(peer, 'receiver should discover the sender via the bootstrap node alone');
      assert.ok(
        peer.candidates.some((c) => c.addr === '203.0.113.99' && c.port === session.summary.transferPort),
        'announced transfer candidates should include the public host'
      );

      await receiver.close();
    } finally {
      await session.stop();
      await bootstrapNode.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('makeTransferCandidateResolver appends the known public host when UPnP is unavailable', async () => {
    const resolver = makeTransferCandidateResolver({ skipUpnp: true, publicHost: '198.51.100.7' });
    const candidates = await resolver(40123);
    assert.ok(
      candidates.some((c) => c.addr === '198.51.100.7' && c.port === 40123),
      'public host must be advertised even without UPnP'
    );
    assert.ok(candidates.length >= 2, 'local candidate should also be present');
  });
});
