import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import { encodeShareCode, decodeShareCode, formatShareCode, normalizeShareCode } from '../src/lib/shareCode.js';

describe('shareCode', () => {
  test('round-trips host, port, and fileHash through encode/decode', () => {
    const fileHash = randomBytes(32).toString('hex');
    const code = encodeShareCode({ fileHash, host: '203.0.113.42', port: 51413 });
    const decoded = decodeShareCode(code);

    assert.equal(decoded.host, '203.0.113.42');
    assert.equal(decoded.port, 51413);
    assert.equal(decoded.fileHash, fileHash);
  });

  test('handles boundary octets and ports correctly', () => {
    const fileHash = 'a'.repeat(64);
    const code = encodeShareCode({ fileHash, host: '0.0.0.0', port: 1 });
    assert.deepEqual(decodeShareCode(code), { host: '0.0.0.0', port: 1, fileHash });

    const code2 = encodeShareCode({ fileHash, host: '255.255.255.255', port: 65535 });
    assert.deepEqual(decodeShareCode(code2), { host: '255.255.255.255', port: 65535, fileHash });
  });

  test('rejects a non-IPv4 host', () => {
    assert.throws(() => encodeShareCode({ fileHash: 'a'.repeat(64), host: 'not-an-ip', port: 80 }));
    assert.throws(() => encodeShareCode({ fileHash: 'a'.repeat(64), host: '::1', port: 80 }));
  });

  test('rejects a malformed fileHash', () => {
    assert.throws(() => encodeShareCode({ fileHash: 'too-short', host: '1.2.3.4', port: 80 }));
  });

  test('rejects an out-of-range port', () => {
    assert.throws(() => encodeShareCode({ fileHash: 'a'.repeat(64), host: '1.2.3.4', port: 0 }));
    assert.throws(() => encodeShareCode({ fileHash: 'a'.repeat(64), host: '1.2.3.4', port: 70000 }));
  });

  test('formatShareCode groups into readable hyphenated blocks and normalizeShareCode reverses it', () => {
    const fileHash = randomBytes(32).toString('hex');
    const code = encodeShareCode({ fileHash, host: '198.51.100.7', port: 4000 });
    const pretty = formatShareCode(code);

    assert.match(pretty, /^[A-Z2-7]{1,5}(-[A-Z2-7]{1,5})*$/);
    assert.equal(normalizeShareCode(pretty), code);
    assert.deepEqual(decodeShareCode(normalizeShareCode(pretty)), { host: '198.51.100.7', port: 4000, fileHash });
  });

  test('decodeShareCode rejects garbage input', () => {
    assert.throws(() => decodeShareCode('NOTAREALCODE'));
    assert.throws(() => decodeShareCode(''));
  });

  test('decodeShareCode rejects an unsupported version byte', () => {
    const fileHash = randomBytes(32).toString('hex');
    const code = encodeShareCode({ fileHash, host: '1.2.3.4', port: 80 });
    const tampered = 'B' + code.slice(1);
    assert.throws(() => decodeShareCode(tampered), /version/);
  });
});
