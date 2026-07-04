export const TYPE = { JSON: 0x00, CHUNK: 0x01 };

export const MSG = {
  FILE_OFFER:            'FILE_OFFER',
  FILE_ACCEPT:           'FILE_ACCEPT',
  CHUNK_REQUEST:         'CHUNK_REQUEST',
  TRANSFER_COMPLETE:     'TRANSFER_COMPLETE',
  KEEPALIVE:             'KEEPALIVE',
  ERROR:                 'ERROR',
  // Mid-session "add another file" flow: the sender broadcasts an offer for
  // a new batch of files to everyone already in the room; each receiver
  // decides independently whether to accept it. Accepted batches are
  // transferred over the same data channel as the original transfer,
  // multiplexed by batchId (see BATCH_STRIDE in transferManager.js).
  FILE_OFFER_ADD:        'FILE_OFFER_ADD',
  FILE_OFFER_ADD_ACCEPT: 'FILE_OFFER_ADD_ACCEPT',
  // Byte-level reload resume (Stage C): lets a reloaded receiver ask for
  // just the hash+proof of a chunk it believes it already wrote to disk
  // before the reload, so it can verify its own on-disk bytes against the
  // trusted merkleRoot without re-downloading them.
  CHUNK_PROOF_REQUEST:   'CHUNK_PROOF_REQUEST',
  CHUNK_PROOF:           'CHUNK_PROOF',
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function concatBytes(chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function buildJSONBody(obj) {
  const typeFlag = new Uint8Array([TYPE.JSON]);
  const body = textEncoder.encode(JSON.stringify(obj));
  return concatBytes([typeFlag, body]);
}

export function buildChunkBody(chunkIndex, chunkHashHex, proof, chunkData) {
  const typeFlag = new Uint8Array([TYPE.CHUNK]);

  const indexBuf = new Uint8Array(4);
  new DataView(indexBuf.buffer).setUint32(0, chunkIndex, false);

  const hashBuf = hexToBytes(chunkHashHex);

  const proofJSON = textEncoder.encode(JSON.stringify(proof));
  const proofLenBuf = new Uint8Array(4);
  new DataView(proofLenBuf.buffer).setUint32(0, proofJSON.length, false);

  const dataBytes = chunkData instanceof Uint8Array ? chunkData : new Uint8Array(chunkData);

  return concatBytes([typeFlag, indexBuf, hashBuf, proofLenBuf, proofJSON, dataBytes]);
}

export function parseMessage(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = view.getUint8(0);

  if (type === TYPE.JSON) {
    return { type: TYPE.JSON, data: JSON.parse(textDecoder.decode(bytes.subarray(1))) };
  }

  if (type === TYPE.CHUNK) {
    const chunkIndex = view.getUint32(1, false);
    const chunkHash = bytesToHex(bytes.subarray(5, 37));
    const proofLen = view.getUint32(37, false);
    const proof = JSON.parse(textDecoder.decode(bytes.subarray(41, 41 + proofLen)));
    const chunkData = bytes.subarray(41 + proofLen);
    return { type: TYPE.CHUNK, chunkIndex, chunkHash, proof, chunkData };
  }

  throw new Error(`Unknown message type: ${type}`);
}