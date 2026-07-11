import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import { encodeShareCode, decodeShareCode, formatShareCode, normalizeShareCode } from '../src/lib/shareCode.js';

describe('shareCode', () => {
  test('round-trips a single candidate plus fileHash through encode/decode', () => {
    const fileHash = randomBytes(32).toString('hex');
    const code = encodeShareCode({ fileHash, candidates: [{ host: '203.0.113.42', port: 51413 }] });
    const decoded = decodeShareCode(code);

    assert.deepEqual(decoded.candidates, [{ host: '203.0.113.42', port: 51413 }]);
    assert.equal(decoded.fileHash, fileHash);
  });

  test('round-trips multiple candidates (LAN + public), preserving order', () => {
    const fileHash = randomBytes(32).toString('hex');
    const candidates = [
      { host: '192.168.1.20', port: 4000 },
      { host: '203.0.113.9', port: 4000 },
    ];
    const code = encodeShareCode({ fileHash, candidates });
    const decoded = decodeShareCode(code);

    assert.deepEqual(decoded.candidates, candidates);
    assert.equal(decoded.fileHash, fileHash);
  });

  test('deduplicates identical candidates', () => {
    const fileHash = randomBytes(32).toString('hex');
    const code = encodeShareCode({
      fileHash,
      candidates: [
        { host: '10.0.0.5', port: 9999 },
        { host: '10.0.0.5', port: 9999 },
        { host: '203.0.113.9', port: 9999 },
      ],
    });
    const decoded = decodeShareCode(code);
    assert.equal(decoded.candidates.length, 2);
  });

  test('handles boundary octets and ports correctly', () => {
    const fileHash = 'a'.repeat(64);
    const code = encodeShareCode({ fileHash, candidates: [{ host: '0.0.0.0', port: 1 }] });
    assert.deepEqual(decodeShareCode(code), { candidates: [{ host: '0.0.0.0', port: 1 }], fileHash });

    const code2 = encodeShareCode({ fileHash, candidates: [{ host: '255.255.255.255', port: 65535 }] });
    assert.deepEqual(decodeShareCode(code2), { candidates: [{ host: '255.255.255.255', port: 65535 }], fileHash });
  });

  test('rejects a non-IPv4 host', () => {
    assert.throws(() => encodeShareCode({ fileHash: 'a'.repeat(64), candidates: [{ host: 'not-an-ip', port: 80 }] }));
    assert.throws(() => encodeShareCode({ fileHash: 'a'.repeat(64), candidates: [{ host: '::1', port: 80 }] }));
  });

  test('rejects a malformed fileHash', () => {
    assert.throws(() => encodeShareCode({ fileHash: 'too-short', candidates: [{ host: '1.2.3.4', port: 80 }] }));
  });

  test('rejects an out-of-range port', () => {
    assert.throws(() => encodeShareCode({ fileHash: 'a'.repeat(64), candidates: [{ host: '1.2.3.4', port: 0 }] }));
    assert.throws(() => encodeShareCode({ fileHash: 'a'.repeat(64), candidates: [{ host: '1.2.3.4', port: 70000 }] }));
  });

  test('rejects an empty candidate list', () => {
    assert.throws(() => encodeShareCode({ fileHash: 'a'.repeat(64), candidates: [] }));
  });

  test('formatShareCode groups into readable hyphenated blocks and normalizeShareCode reverses it', () => {
    const fileHash = randomBytes(32).toString('hex');
    const code = encodeShareCode({ fileHash, candidates: [{ host: '198.51.100.7', port: 4000 }] });
    const pretty = formatShareCode(code);

    assert.match(pretty, /^[A-Z2-7]{1,5}(-[A-Z2-7]{1,5})*$/);
    assert.equal(normalizeShareCode(pretty), code);
    assert.deepEqual(decodeShareCode(normalizeShareCode(pretty)), { candidates: [{ host: '198.51.100.7', port: 4000 }], fileHash });
  });

  test('decodeShareCode rejects garbage input', () => {
    assert.throws(() => decodeShareCode('NOTAREALCODE'));
    assert.throws(() => decodeShareCode(''));
  });

  test('decodeShareCode rejects an unsupported version byte', () => {
    const fileHash = randomBytes(32).toString('hex');
    const code = encodeShareCode({ fileHash, candidates: [{ host: '1.2.3.4', port: 80 }] });
    const tampered = 'B' + code.slice(1);
    assert.throws(() => decodeShareCode(tampered), /version/);
  });
});
