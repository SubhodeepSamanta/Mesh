import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { open } from 'fs/promises';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DHTNode } from '../src/dht.js';
import { indexFile } from '../src/chunker.js';
import { createChunkServer } from '../src/chunkServer.js';
import { TurnClient, generateTurnCredentials, createRelayListener } from '../src/net/turn.js';
import { ReliableDatagramChannel } from '../src/net/reliableDatagram.js';
import { connectToPeer } from '../src/net/connect.js';
import { startFakeTurnServer } from './helpers/fakeTurnServer.js';

const SECRET = 'connect-test-secret';

async function makeTempFile(content) {
  const dir = await mkdtemp(join(tmpdir(), 'mesh-connect-test-'));
  const filePath = join(dir, 'payload.bin');
  await writeFile(filePath, content);
  return { dir, filePath };
}

describe('connectToPeer', () => {
  test('uses the direct tier when the sender is reachable on the given address:port', async () => {
    const { dir, filePath } = await makeTempFile(Buffer.from('direct tier payload'));
    try {
      const { hashes, tree, merkleRoot, totalChunks, fileSize, chunkSize } = await indexFile(filePath);
      const fileHandle = await open(filePath, 'r');
      const server = createChunkServer({ fileHandle, hashes, tree, merkleRoot, fileName: 'payload.bin', fileSize, totalChunks, chunkSize });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;

      const { connection, tier } = await connectToPeer({ addr: '127.0.0.1', port });
      assert.equal(tier, 'direct');
      const manifest = await connection.waitForMetadata();
      assert.equal(manifest.merkleRoot, merkleRoot);

      connection.close();
      await new Promise((resolve) => server.close(resolve));
      await fileHandle.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('falls back to the relay tier end to end when direct dial fails, via a fake TURN server and real DHT relay-hello handshake', async () => {
    const { dir, filePath } = await makeTempFile(Buffer.from('relay tier payload, a little longer than one MTU chunk. '.repeat(50)));
    try {
      const fakeTurn = startFakeTurnServer({ secret: SECRET });
      const { host: turnHost, port: turnPort } = await fakeTurn.ready();

      const senderDht = new DHTNode();
      const receiverDht = new DHTNode();
      await senderDht.listen();
      await receiverDht.listen();
      receiverDht.routingTable.addPeer({ id: senderDht.nodeId, addr: '127.0.0.1', port: senderDht.port });

      const { hashes, tree, merkleRoot, totalChunks, fileSize, chunkSize } = await indexFile(filePath);
      const fileHandle = await open(filePath, 'r');
      const server = createChunkServer({ fileHandle, hashes, tree, merkleRoot, fileName: 'payload.bin', fileSize, totalChunks, chunkSize });

      const { username, credential } = generateTurnCredentials(SECRET, `${senderDht.nodeId}:${merkleRoot}`);
      const turnClient = new TurnClient({ host: turnHost, port: turnPort, username, credential });
      const { relayedAddress } = await turnClient.allocate({ timeoutMs: 2000 });

      const relayListener = createRelayListener(turnClient, (addr, port, virtualChannel) => {
        const reliableChannel = new ReliableDatagramChannel(virtualChannel);
        server.handleRelayConnection(reliableChannel);
      });

      senderDht.addRelayPermissionHandler((addr, port) => turnClient.createPermission(addr, port, { timeoutMs: 2000 }));

      const fileHash = merkleRoot;
      await senderDht.announceFile(fileHash, 1, { addr: relayedAddress.address, port: relayedAddress.port });

      const peers = await receiverDht.getPeersForFile(fileHash);
      const peerInfo = peers.find((p) => p.port === 1);
      assert.ok(peerInfo);
      assert.ok(peerInfo.relay);

      const unreachablePeerInfo = { ...peerInfo, addr: '127.0.0.1', port: 1 };

      const { connection, tier } = await connectToPeer(unreachablePeerInfo, { dhtNode: receiverDht, directTimeoutMs: 300 });
      assert.equal(tier, 'relay');

      const manifest = await connection.waitForMetadata();
      assert.equal(manifest.merkleRoot, merkleRoot);
      assert.equal(manifest.totalChunks, totalChunks);

      const chunkMsg = await connection.requestChunk(0);
      assert.equal(chunkMsg.chunkHash, hashes[0]);

      connection.close();
      relayListener.close();
      turnClient.close();
      await new Promise((resolve) => server.close(resolve));
      await fileHandle.close();
      await senderDht.close();
      await receiverDht.close();
      await fakeTurn.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, { timeout: 20000 });

  test('rejects with the direct error when there is no relay info to fall back to', async () => {
    await assert.rejects(
      connectToPeer({ addr: '127.0.0.1', port: 1 }, { directTimeoutMs: 200 }),
      /timed out|ECONNREFUSED/
    );
  });
});
