export const SHARE_CODE_VERSION = 2;
export const MAX_CANDIDATES = 4;
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
    throw new Error(`Only IPv4 candidate addresses are supported, got: ${host}`);
  }
  return parts;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const result = [];
  for (const c of candidates) {
    const key = `${c.host}:${c.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(c);
  }
  return result;
}

export function encodeShareCode({ fileHash, candidates }) {
  if (!/^[0-9a-f]{64}$/i.test(fileHash)) {
    throw new Error('fileHash must be a 64-character hex sha256 digest');
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('At least one bootstrap candidate {host, port} is required');
  }

  const uniqueCandidates = dedupeCandidates(candidates).slice(0, MAX_CANDIDATES);

  const buf = Buffer.alloc(1 + 1 + uniqueCandidates.length * 6 + 32);
  buf.writeUInt8(SHARE_CODE_VERSION, 0);
  buf.writeUInt8(uniqueCandidates.length, 1);

  let offset = 2;
  for (const { host, port } of uniqueCandidates) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid candidate port: ${port}`);
    }
    const hostParts = parseIPv4(host);
    hostParts.forEach((n, i) => buf.writeUInt8(n, offset + i));
    buf.writeUInt16BE(port, offset + 4);
    offset += 6;
  }

  Buffer.from(fileHash, 'hex').copy(buf, offset);

  return base32Encode(buf);
}

export function decodeShareCode(code) {
  const buf = base32Decode(code);
  if (buf.length < 2) {
    throw new Error('Invalid mesh share code: too short');
  }

  const version = buf.readUInt8(0);
  if (version !== SHARE_CODE_VERSION) {
    throw new Error(`Unsupported share code version: ${version}`);
  }

  const count = buf.readUInt8(1);
  const expectedLength = 2 + count * 6 + 32;
  if (count === 0 || count > MAX_CANDIDATES || buf.length !== expectedLength) {
    throw new Error('Invalid mesh share code: malformed candidate list');
  }

  const candidates = [];
  let offset = 2;
  for (let i = 0; i < count; i++) {
    const host = [buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]].join('.');
    const port = buf.readUInt16BE(offset + 4);
    candidates.push({ host, port });
    offset += 6;
  }

  const fileHash = buf.subarray(offset, offset + 32).toString('hex');

  return { candidates, fileHash };
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
