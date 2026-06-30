import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { randomBytes } from 'crypto';
import { DHTNode } from '../src/dht.js';
import { buildMerkleTree, getMerkleProof, sha256, generateKeyPair, exportPublicKey, deriveSharedKey, encrypt } from '../src/crypto.js';
import { sendJSON, sendChunk, createFramer, parseMessage, MSG, TYPE } from '../src/protocol.js';
import { downloadFile } from '../src/transfer.js';

function startTestSeeder(chunks, hashes, tree, merkleRoot, fileSize, port) {
  return new Promise((resolveListen) => {
    const server = net.createServer((socket) => {
      socket.setNoDelay(true);
      socket.setMaxListeners(0);

      const keyPair = generateKeyPair();
      let sharedKey = null;

      const framer = createFramer((body) => {
        const msg = parseMessage(body);
        if (msg.type !== TYPE.JSON) return;

        if (msg.data.type === MSG.KEY_EXCHANGE) {
          const theirPub = Buffer.from(msg.data.publicKey, 'base64');
          sharedKey = deriveSharedKey(keyPair.privateKey, theirPub);
          const myPub = exportPublicKey(keyPair).toString('base64');
          sendJSON(socket, { type: MSG.KEY_EXCHANGE, publicKey: myPub });
          return;
        }

        if (msg.data.type === MSG.CHUNK_REQUEST && sharedKey) {
          const { index } = msg.data;
          const proof = getMerkleProof(tree, index);
          const encrypted = encrypt(chunks[index], sharedKey);
          sendChunk(socket, index, hashes[index], proof, encrypted);
        }
      });

      socket.on('data', framer);
    });

    server.listen(port, '127.0.0.1', () => resolveListen(server));
  });
}

describe('engine integration', () => {
  it('downloads a file end to end via DHT discovery and encrypted swarm transfer', async () => {
    const numChunks = 10;
    const chunkSize = 1024;
    const chunks = [];
    const hashes = [];
    for (let i = 0; i < numChunks; i++) {
      const chunk = randomBytes(chunkSize);
      chunks.push(chunk);
      hashes.push(sha256(chunk));
    }
    const tree = buildMerkleTree(hashes);
    const fileHash = sha256(Buffer.concat(chunks));

    const seederNode = new DHTNode();
    const downloaderNode = new DHTNode();
    await seederNode.listen();
    await downloaderNode.listen();

    downloaderNode.routingTable.addPeer({
      id: seederNode.nodeId, addr: '127.0.0.1', port: seederNode.port,
    });

    const tcpPort = 18500 + Math.floor(Math.random() * 500);
    const server = await startTestSeeder(chunks, hashes, tree, tree.root, numChunks * chunkSize, tcpPort);

    await seederNode.announceFile(fileHash, tcpPort);

    const result = await downloadFile(fileHash, numChunks, tree.root, downloaderNode);

    const expected = Buffer.concat(chunks);
    assert.deepEqual(result, expected);

    server.close();
    await seederNode.close();
    await downloaderNode.close();
  });

  it('throws a clear error when no peers have the file', async () => {
    const downloaderNode = new DHTNode();
    await downloaderNode.listen();

    const fakeFileHash = sha256(Buffer.from('nobody has this'));

    await assert.rejects(
      () => downloadFile(fakeFileHash, 5, 'a'.repeat(64), downloaderNode),
      /No peers found/
    );

    await downloaderNode.close();
  });
it('reports detailed errors when all peer connections fail', async () => {
    const downloaderNode = new DHTNode();
    const fakeSeederNode = new DHTNode();
    await downloaderNode.listen();
    await fakeSeederNode.listen();

    downloaderNode.routingTable.addPeer({
      id: fakeSeederNode.nodeId, addr: '127.0.0.1', port: fakeSeederNode.port,
    });

    const fileHash = sha256(Buffer.from('file with dead peer'));
    await fakeSeederNode.announceFile(fileHash, 19999);

    await assert.rejects(
      () => downloadFile(fileHash, 5, 'a'.repeat(64), downloaderNode),
      (err) => {
        assert.match(err.message, /Could not connect to any peer/);
        assert.match(err.message, /19999/);
        assert.match(err.message, /ECONNREFUSED/);
        return true;
      }
    );

    await downloaderNode.close();
    await fakeSeederNode.close();
  });
});