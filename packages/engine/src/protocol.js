export const PROTOCOL_VERSION = '1.0.0';import net from 'net';

const HEADER_SIZE = 4;
const MAX_MESSAGE_SIZE = 100 * 1024 * 1024;

export const MSG = {
  FILE_OFFER:        'FILE_OFFER',
  FILE_ACCEPT:       'FILE_ACCEPT',
  FILE_REJECT:       'FILE_REJECT',
  CHUNK_REQUEST:     'CHUNK_REQUEST',
  CHUNK_DATA:        'CHUNK_DATA',
  CHUNK_NACK:        'CHUNK_NACK',
  TRANSFER_COMPLETE: 'TRANSFER_COMPLETE',
  KEEPALIVE:         'KEEPALIVE',
  ERROR:             'ERROR',
};

export const TYPE = {
  JSON:  0x00,
  CHUNK: 0x01,
};

export function sendMessage(socket, data) {
  const isBuffer = Buffer.isBuffer(data);
  const body = isBuffer ? data : Buffer.from(JSON.stringify(data), 'utf8');
  const header = Buffer.allocUnsafe(HEADER_SIZE);
  header.writeUInt32BE(body.length, 0);
  const packet = Buffer.concat([header, body]);
  const ok = socket.write(packet);
  if (!ok) {
    return new Promise(resolve => socket.once('drain', resolve));
  }
  return Promise.resolve();
}

export function sendJSON(socket, obj) {
  const typeFlag = Buffer.from([TYPE.JSON]);
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  return sendMessage(socket, Buffer.concat([typeFlag, body]));
}

export function sendChunk(socket, chunkIndex, chunkHash, chunkBuffer) {
  const typeFlag = Buffer.from([TYPE.CHUNK]);
  const indexBuf = Buffer.allocUnsafe(4);
  indexBuf.writeUInt32BE(chunkIndex, 0);
  const hashBuf = Buffer.from(chunkHash, 'hex');
  const body = Buffer.concat([typeFlag, indexBuf, hashBuf, chunkBuffer]);
  return sendMessage(socket, body);
}

export function createFramer(onMessage) {
  let accumulator = Buffer.alloc(0);
  return function (incoming) {
    accumulator = Buffer.concat([accumulator, incoming]);
    while (true) {
      if (accumulator.length < HEADER_SIZE) break;
      const bodyLength = accumulator.readUInt32BE(0);
      if (bodyLength > MAX_MESSAGE_SIZE) {
        throw new Error(`Message too large: ${bodyLength} bytes`);
      }
      if (accumulator.length < HEADER_SIZE + bodyLength) break;
      const body = Buffer.from(accumulator.slice(HEADER_SIZE, HEADER_SIZE + bodyLength));
      accumulator = Buffer.from(accumulator.slice(HEADER_SIZE + bodyLength));
      onMessage(body);
    }
  };
}

export function parseMessage(body) {
  const type = body.readUInt8(0);
  if (type === TYPE.JSON) {
    return { type: TYPE.JSON, data: JSON.parse(body.slice(1).toString('utf8')) };
  }
  if (type === TYPE.CHUNK) {
    const chunkIndex = body.readUInt32BE(1);
    const chunkHash = body.slice(5, 37).toString('hex');
    const chunkData = Buffer.from(body.slice(37));
    return { type: TYPE.CHUNK, chunkIndex, chunkHash, chunkData };
  }
  throw new Error(`Unknown message type: ${type}`);
}