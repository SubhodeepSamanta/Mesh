import { randomBytes, createHash, createHmac } from 'crypto';

export const MAGIC_COOKIE = 0x2112a442;

export const MESSAGE_TYPE = {
  BINDING_REQUEST: 0x0001,
  BINDING_SUCCESS: 0x0101,
  ALLOCATE_REQUEST: 0x0003,
  ALLOCATE_SUCCESS: 0x0103,
  ALLOCATE_ERROR: 0x0113,
  REFRESH_REQUEST: 0x0004,
  REFRESH_SUCCESS: 0x0104,
  REFRESH_ERROR: 0x0114,
  CREATE_PERMISSION_REQUEST: 0x0008,
  CREATE_PERMISSION_SUCCESS: 0x0108,
  CREATE_PERMISSION_ERROR: 0x0118,
  SEND_INDICATION: 0x0016,
  DATA_INDICATION: 0x0017,
};

export const ATTR = {
  MAPPED_ADDRESS: 0x0001,
  USERNAME: 0x0006,
  MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009,
  REALM: 0x0014,
  NONCE: 0x0015,
  XOR_PEER_ADDRESS: 0x0012,
  DATA: 0x0013,
  XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019,
  LIFETIME: 0x000d,
  XOR_MAPPED_ADDRESS: 0x0020,
};

export const UDP_TRANSPORT = 17;

function pad4(len) {
  const rem = len % 4;
  return rem === 0 ? 0 : 4 - rem;
}

export function encodeAttributes(attrs) {
  const chunks = [];
  for (const { type, value } of attrs) {
    const header = Buffer.alloc(4);
    header.writeUInt16BE(type, 0);
    header.writeUInt16BE(value.length, 2);
    chunks.push(header, value, Buffer.alloc(pad4(value.length)));
  }
  return Buffer.concat(chunks);
}

export function encodeMessage(type, transactionId, attrs) {
  const attrBuf = encodeAttributes(attrs);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(attrBuf.length, 2);
  header.writeUInt32BE(MAGIC_COOKIE, 4);
  transactionId.copy(header, 8);
  return Buffer.concat([header, attrBuf]);
}

export function decodeMessage(buffer) {
  if (buffer.length < 20) throw new Error('STUN/TURN message too short');
  const type = buffer.readUInt16BE(0);
  const length = buffer.readUInt16BE(2);
  const cookie = buffer.readUInt32BE(4);
  const transactionId = buffer.subarray(8, 20);
  if (cookie !== MAGIC_COOKIE) throw new Error('Invalid STUN/TURN magic cookie');

  const attrs = [];
  let offset = 20;
  const end = Math.min(buffer.length, 20 + length);
  while (offset + 4 <= end) {
    const attrType = buffer.readUInt16BE(offset);
    const attrLen = buffer.readUInt16BE(offset + 2);
    const valueStart = offset + 4;
    const valueEnd = valueStart + attrLen;
    if (valueEnd > end) break;
    attrs.push({ type: attrType, value: buffer.subarray(valueStart, valueEnd) });
    offset = valueStart + attrLen + pad4(attrLen);
  }

  return { type, length, transactionId, attrs };
}

export function findAttr(attrs, type) {
  const found = attrs.find((a) => a.type === type);
  return found ? found.value : null;
}

export function encodeXorAddress(address, port) {
  const parts = address.split('.').map(Number);
  const addrNum = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const xport = port ^ (MAGIC_COOKIE >>> 16);
  const xaddr = (addrNum ^ MAGIC_COOKIE) >>> 0;
  const value = Buffer.alloc(8);
  value.writeUInt8(0, 0);
  value.writeUInt8(0x01, 1);
  value.writeUInt16BE(xport, 2);
  value.writeUInt32BE(xaddr, 4);
  return value;
}

export function decodeXorAddress(value) {
  const xport = value.readUInt16BE(2);
  const port = xport ^ (MAGIC_COOKIE >>> 16);
  const xaddr = value.readUInt32BE(4);
  const addrNum = (xaddr ^ MAGIC_COOKIE) >>> 0;
  const address = [(addrNum >>> 24) & 0xff, (addrNum >>> 16) & 0xff, (addrNum >>> 8) & 0xff, addrNum & 0xff].join('.');
  return { address, port };
}

export function encodeErrorCode(code, reason) {
  const reasonBuf = Buffer.from(reason, 'utf8');
  const value = Buffer.alloc(4 + reasonBuf.length);
  value.writeUInt8(0, 0);
  value.writeUInt8(0, 1);
  value.writeUInt8(Math.floor(code / 100), 2);
  value.writeUInt8(code % 100, 3);
  reasonBuf.copy(value, 4);
  return value;
}

export function decodeErrorCode(value) {
  const errorClass = value.readUInt8(2) & 0x07;
  const errorNumber = value.readUInt8(3);
  const reason = value.subarray(4).toString('utf8');
  return { code: errorClass * 100 + errorNumber, reason };
}

export function longTermKey(username, realm, password) {
  return createHash('md5').update(`${username}:${realm}:${password}`).digest();
}

export function appendMessageIntegrity(type, transactionId, attrsWithoutMI, key) {
  const withoutMI = encodeAttributes(attrsWithoutMI);
  const dummyHeader = Buffer.alloc(20);
  dummyHeader.writeUInt16BE(type, 0);
  dummyHeader.writeUInt16BE(withoutMI.length + 24, 2);
  dummyHeader.writeUInt32BE(MAGIC_COOKIE, 4);
  transactionId.copy(dummyHeader, 8);

  const hmac = createHmac('sha1', key).update(Buffer.concat([dummyHeader, withoutMI])).digest();
  return [...attrsWithoutMI, { type: ATTR.MESSAGE_INTEGRITY, value: hmac }];
}

export function verifyMessageIntegrity(message, key) {
  const miIndex = message.attrs.findIndex((a) => a.type === ATTR.MESSAGE_INTEGRITY);
  if (miIndex === -1) return false;
  const before = message.attrs.slice(0, miIndex);
  const rebuilt = appendMessageIntegrity(message.type, message.transactionId, before, key);
  return rebuilt[rebuilt.length - 1].value.equals(message.attrs[miIndex].value);
}

export function newTransactionId() {
  return randomBytes(12);
}

export function uint32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}
