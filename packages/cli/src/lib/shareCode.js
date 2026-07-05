export const SHARE_CODE_VERSION = 1;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input) {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid character in share code: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function parseIPv4(host) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`Only IPv4 bootstrap addresses are supported, got: ${host}`);
  }
  return parts;
}

export function encodeShareCode({ fileHash, host, port }) {
  if (!/^[0-9a-f]{64}$/i.test(fileHash)) {
    throw new Error('fileHash must be a 64-character hex sha256 digest');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid bootstrap port: ${port}`);
  }

  const hostParts = parseIPv4(host);
  const hashBytes = Buffer.from(fileHash, 'hex');

  const buf = Buffer.alloc(1 + 4 + 2 + 32);
  buf.writeUInt8(SHARE_CODE_VERSION, 0);
  hostParts.forEach((n, i) => buf.writeUInt8(n, 1 + i));
  buf.writeUInt16BE(port, 5);
  hashBytes.copy(buf, 7);

  return base32Encode(buf);
}

export function decodeShareCode(code) {
  const buf = base32Decode(code);
  if (buf.length !== 39) {
    throw new Error('Invalid mesh share code: wrong length');
  }

  const version = buf.readUInt8(0);
  if (version !== SHARE_CODE_VERSION) {
    throw new Error(`Unsupported share code version: ${version}`);
  }

  const host = [buf[1], buf[2], buf[3], buf[4]].join('.');
  const port = buf.readUInt16BE(5);
  const fileHash = buf.subarray(7, 39).toString('hex');

  return { host, port, fileHash };
}

export function formatShareCode(code, groupSize = 5) {
  const groups = [];
  for (let i = 0; i < code.length; i += groupSize) {
    groups.push(code.slice(i, i + groupSize));
  }
  return groups.join('-');
}

export function normalizeShareCode(input) {
  return input.replace(/[\s-]/g, '');
}
