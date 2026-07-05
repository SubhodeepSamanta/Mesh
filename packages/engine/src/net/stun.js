import dgram from 'dgram';
import { randomBytes } from 'crypto';

export const STUN_MAGIC_COOKIE = 0x2112a442;
export const STUN_BINDING_REQUEST = 0x0001;
export const STUN_BINDING_RESPONSE = 0x0101;
export const ATTR_MAPPED_ADDRESS = 0x0001;
export const ATTR_XOR_MAPPED_ADDRESS = 0x0020;
export const DEFAULT_STUN_SERVERS = [
  { host: 'stun.l.google.com', port: 19302 },
  { host: 'stun1.l.google.com', port: 19302 },
  { host: 'stun2.l.google.com', port: 19302 },
];

export function buildBindingRequest(transactionId = randomBytes(12)) {
  const header = Buffer.alloc(20);
  header.writeUInt16BE(STUN_BINDING_REQUEST, 0);
  header.writeUInt16BE(0, 2);
  header.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  transactionId.copy(header, 8);
  return { transactionId, buffer: header };
}

function numToIPv4(num) {
  return [(num >>> 24) & 0xff, (num >>> 16) & 0xff, (num >>> 8) & 0xff, num & 0xff].join('.');
}

export function parseBindingResponse(buffer, expectedTransactionId = null) {
  if (buffer.length < 20) throw new Error('STUN response too short');

  const type = buffer.readUInt16BE(0);
  const length = buffer.readUInt16BE(2);
  const cookie = buffer.readUInt32BE(4);
  const transactionId = buffer.subarray(8, 20);

  if (cookie !== STUN_MAGIC_COOKIE) throw new Error('Invalid STUN magic cookie');
  if (type !== STUN_BINDING_RESPONSE) throw new Error(`Unexpected STUN message type: 0x${type.toString(16)}`);
  if (expectedTransactionId && !transactionId.equals(expectedTransactionId)) {
    throw new Error('STUN transaction ID mismatch');
  }

  let offset = 20;
  const end = Math.min(buffer.length, 20 + length);
  let mapped = null;
  let xorMapped = null;

  while (offset + 4 <= end) {
    const attrType = buffer.readUInt16BE(offset);
    const attrLen = buffer.readUInt16BE(offset + 2);
    const valueStart = offset + 4;
    const valueEnd = valueStart + attrLen;
    if (valueEnd > end) break;
    const value = buffer.subarray(valueStart, valueEnd);

    if (attrType === ATTR_XOR_MAPPED_ADDRESS && value.length >= 8 && value.readUInt8(1) === 0x01) {
      const xport = value.readUInt16BE(2);
      const port = xport ^ (STUN_MAGIC_COOKIE >>> 16);
      const xaddr = value.readUInt32BE(4);
      xorMapped = { address: numToIPv4(xaddr ^ STUN_MAGIC_COOKIE), port };
    } else if (attrType === ATTR_MAPPED_ADDRESS && value.length >= 8 && value.readUInt8(1) === 0x01) {
      const port = value.readUInt16BE(2);
      mapped = { address: numToIPv4(value.readUInt32BE(4)), port };
    }

    const padded = attrLen % 4 === 0 ? attrLen : attrLen + (4 - (attrLen % 4));
    offset = valueStart + padded;
  }

  const result = xorMapped || mapped;
  if (!result) throw new Error('STUN response missing a mapped-address attribute');
  return result;
}

export function getReflexiveAddress({ socket = null, stunHost = DEFAULT_STUN_SERVERS[0].host, stunPort = DEFAULT_STUN_SERVERS[0].port, timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const ownSocket = !socket;
    const sock = socket || dgram.createSocket('udp4');
    const { transactionId, buffer } = buildBindingRequest();
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.removeListener('message', onMessage);
      if (ownSocket) sock.close();
      fn(arg);
    };

    const onMessage = (msg) => {
      try {
        const result = parseBindingResponse(msg, transactionId);
        finish(resolve, result);
      } catch {
        return;
      }
    };

    const timer = setTimeout(() => {
      finish(reject, new Error(`STUN request to ${stunHost}:${stunPort} timed out`));
    }, timeoutMs);

    sock.on('message', onMessage);
    if (ownSocket) sock.once('error', (e) => finish(reject, e));

    sock.send(buffer, stunPort, stunHost, (err) => {
      if (err) finish(reject, err);
    });
  });
}

export async function discoverReflexiveAddress(servers = DEFAULT_STUN_SERVERS, opts = {}) {
  let lastError = null;
  for (const server of servers) {
    try {
      return await getReflexiveAddress({ ...opts, stunHost: server.host, stunPort: server.port });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('No STUN servers configured');
}
