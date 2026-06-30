import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { randomBytes } from 'crypto';
import { PeerConnection } from '../src/peer.js';
import { sendJSON, sendChunk, createFramer, parseMessage, MSG, TYPE } from '../src/protocol.js';
import { generateKeyPair, exportPublicKey, deriveSharedKey, encrypt, sha256, buildMerkleTree, getMerkleProof } from '../src/crypto.js';

function startEncryptedTestSeeder(chunkData, chunkHash, proof, port) {
  return new Promise((resolveListen) => {
    const keyPair = generateKeyPair();
    let sharedKey = null;

    const server = net.createServer((socket) => {
      socket.setNoDelay(true);
      socket.setMaxListeners(0);

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
          const encrypted = encrypt(chunkData, sharedKey);
          sendChunk(socket, msg.data.index, chunkHash, proof, encrypted);
        }
      });

      socket.on('data', framer);
    });

    server.listen(port, '127.0.0.1', () => resolveListen(server));
  });
}

describe('peer connection encryption', () => {
  it('performs ECDH handshake and decrypts chunk correctly', async () => {
    const plaintext = randomBytes(1024);
    const chunkHash = sha256(plaintext);
    const tree = buildMerkleTree([chunkHash]);
    const proof = getMerkleProof(tree, 0);

    const port = 19700 + Math.floor(Math.random() * 200);
    const server = await startEncryptedTestSeeder(plaintext, chunkHash, proof, port);

    const conn = new PeerConnection('127.0.0.1', port);
    await conn.connect();

    assert.ok(conn.sharedKey, 'shared key should be established after handshake');

    const result = await conn.requestChunk(0);
    assert.deepEqual(result.chunkData, plaintext);

    conn.close();
    server.close();
  });

  it('rejects tampered ciphertext during decryption', async () => {
    const plaintext = randomBytes(512);
    const chunkHash = sha256(plaintext);
    const tree = buildMerkleTree([chunkHash]);
    const proof = getMerkleProof(tree, 0);

    const port = 19900 + Math.floor(Math.random() * 200);

    const keyPair = generateKeyPair();
    let sharedKey = null;

    const server = net.createServer((socket) => {
      socket.setNoDelay(true);
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
          const encrypted = encrypt(plaintext, sharedKey);
          encrypted[encrypted.length - 1] ^= 0xff;
          sendChunk(socket, msg.data.index, chunkHash, proof, encrypted);
        }
      });
      socket.on('data', framer);
    });

    await new Promise(r => server.listen(port, '127.0.0.1', r));

    const conn = new PeerConnection('127.0.0.1', port);
    await conn.connect();

    await assert.rejects(() => conn.requestChunk(0), /decryption failed/i);

    conn.close();
    server.close();
  });
});