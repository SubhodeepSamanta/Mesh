import { createHash, createCipheriv, createDecipheriv, randomBytes, generateKeyPairSync, diffieHellman, hkdfSync, createPublicKey } from 'crypto';

export const CIPHER = 'aes-256-gcm';

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function buildMerkleRoot(hashes) {
  if (hashes.length === 0) throw new Error('No hashes provided');
  if (hashes.length === 1) return hashes[0];
  let level = hashes.map(h => Buffer.from(h, 'hex'));
  if (level.length % 2 !== 0) level.push(level[level.length - 1]);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(Buffer.from(
        createHash('sha256').update(Buffer.concat([level[i], level[i + 1]])).digest()
      ));
    }
    level = next;
    if (level.length > 1 && level.length % 2 !== 0) level.push(level[level.length - 1]);
  }
  return level[0].toString('hex');
}

export function buildMerkleTree(hashes) {
  if (hashes.length === 0) throw new Error('No hashes provided');
  let level = hashes.map(h => Buffer.from(h, 'hex'));
  if (level.length % 2 !== 0) level.push(level[level.length - 1]);
  const levels = [level.map(b => b.toString('hex'))];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(Buffer.from(
        createHash('sha256').update(Buffer.concat([level[i], level[i + 1]])).digest()
      ));
    }
    level = next;
    if (level.length > 1 && level.length % 2 !== 0) level.push(level[level.length - 1]);
    levels.push(level.map(b => b.toString('hex')));
  }
  return { root: level[0].toString('hex'), levels };
}

export function getMerkleProof(tree, index) {
  const proof = [];
  let i = index;
  for (let lvl = 0; lvl < tree.levels.length - 1; lvl++) {
    const level = tree.levels[lvl];
    const isLeft = i % 2 === 0;
    const siblingIndex = isLeft ? i + 1 : i - 1;
    if (siblingIndex < level.length) {
      proof.push({ hash: level[siblingIndex], position: isLeft ? 'right' : 'left' });
    }
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyChunk(chunkData, proof, expectedRoot) {
  let current = Buffer.from(
    createHash('sha256').update(chunkData).digest()
  );
  for (const { hash: sibling, position } of proof) {
    const siblingBuf = Buffer.from(sibling, 'hex');
    const combined = position === 'right'
      ? Buffer.concat([current, siblingBuf])
      : Buffer.concat([siblingBuf, current]);
    current = Buffer.from(createHash('sha256').update(combined).digest());
  }
  return current.toString('hex') === expectedRoot;
}

export function getMerkleProof(tree, index) {
  const proof = [];
  let i = index;
  for (let lvl = 0; lvl < tree.levels.length - 1; lvl++) {
    const level = tree.levels[lvl];
    const isLeft = i % 2 === 0;
    const siblingIndex = isLeft ? i + 1 : i - 1;
    if (siblingIndex < level.length) {
      proof.push({ hash: level[siblingIndex], position: isLeft ? 'right' : 'left' });
    }
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyChunk(chunkData, proof, expectedRoot) {
  let current = sha256(chunkData);
  for (const { hash: sibling, position } of proof) {
    const combined = position === 'right'
      ? current + sibling
      : sibling + current;
    current = sha256(Buffer.from(combined, 'utf8'));
  }
  return current === expectedRoot;
}

export function generateKeyPair() {
  return generateKeyPairSync('x25519');
}

export function exportPublicKey(keyPair) {
  return keyPair.publicKey.export({ type: 'spki', format: 'der' });
}

export function importPublicKey(derBytes) {
  return createPublicKey({ key: Buffer.from(derBytes), type: 'spki', format: 'der' });
}

export function deriveSharedKey(myPrivateKey, theirPublicKeyDER) {
  const theirPublicKey = createPublicKey({ key: Buffer.from(theirPublicKeyDER), type: 'spki', format: 'der' });
  const raw = diffieHellman({ privateKey: myPrivateKey, publicKey: theirPublicKey });
  return Buffer.from(hkdfSync('sha256', raw, Buffer.from('mesh-v1'), Buffer.from('mesh-encryption-key'), 32));
}

export function encrypt(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decrypt(pkg, key) {
  const iv = pkg.slice(0, 12);
  const authTag = pkg.slice(12, 28);
  const encrypted = pkg.slice(28);
  const decipher = createDecipheriv(CIPHER, key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    throw new Error('Decryption failed: message authentication failed');
  }
}