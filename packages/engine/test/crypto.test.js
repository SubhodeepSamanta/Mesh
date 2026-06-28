import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPair,
  exportPublicKey,
  deriveSharedKey,
  encrypt,
  decrypt,
} from '../src/crypto.js';

describe('crypto', () => {
  it('ECDH key exchange produces identical shared keys on both sides', () => {
    const aliceKeys = generateKeyPair();
    const bobKeys   = generateKeyPair();
    const alicePub  = exportPublicKey(aliceKeys);
    const bobPub    = exportPublicKey(bobKeys);
    const aliceShared = deriveSharedKey(aliceKeys.privateKey, bobPub);
    const bobShared   = deriveSharedKey(bobKeys.privateKey, alicePub);
    assert.deepEqual(aliceShared, bobShared);
  });

  it('encrypt and decrypt round trip produces original plaintext', () => {
    const keys      = generateKeyPair();
    const sharedKey = deriveSharedKey(keys.privateKey, exportPublicKey(keys));
    const plaintext = Buffer.from('hello mesh this is a secret message');
    const ciphertext = encrypt(plaintext, sharedKey);
    const decrypted  = decrypt(ciphertext, sharedKey);
    assert.deepEqual(decrypted, plaintext);
  });

  it('decrypt throws when ciphertext is tampered', () => {
    const keys      = generateKeyPair();
    const sharedKey = deriveSharedKey(keys.privateKey, exportPublicKey(keys));
    const ciphertext = encrypt(Buffer.from('secret data'), sharedKey);
    ciphertext[30] = ciphertext[30] ^ 0xff;
    assert.throws(() => decrypt(ciphertext, sharedKey), /authentication failed/);
  });

  it('two different encryptions of same plaintext produce different ciphertext', () => {
    const keys      = generateKeyPair();
    const sharedKey = deriveSharedKey(keys.privateKey, exportPublicKey(keys));
    const plaintext = Buffer.from('same message');
    const ct1 = encrypt(plaintext, sharedKey);
    const ct2 = encrypt(plaintext, sharedKey);
    assert.notDeepEqual(ct1, ct2);
  });
});