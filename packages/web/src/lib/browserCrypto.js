export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return bytesToHex(new Uint8Array(digest))
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}

async function hashPair(hexA, hexB) {
  const combined = new Uint8Array(64)
  combined.set(hexToBytes(hexA), 0)
  combined.set(hexToBytes(hexB), 32)
  return sha256Hex(combined.buffer)
}

export async function buildMerkleTree(hashes) {
  if (hashes.length === 0) throw new Error('No hashes provided')
  let level = [...hashes]
  if (level.length % 2 !== 0) level.push(level[level.length - 1])
  const levels = [level]
  while (level.length > 1) {
    const next = []
    for (let i = 0; i < level.length; i += 2) {
      next.push(await hashPair(level[i], level[i + 1]))
    }
    level = next
    if (level.length > 1 && level.length % 2 !== 0) level.push(level[level.length - 1])
    levels.push(level)
  }
  return { root: level[0], levels }
}

export function getMerkleProof(tree, index) {
  const proof = []
  let i = index
  for (let lvl = 0; lvl < tree.levels.length - 1; lvl++) {
    const level = tree.levels[lvl]
    const isLeft = i % 2 === 0
    const siblingIndex = isLeft ? i + 1 : i - 1
    if (siblingIndex < level.length) {
      proof.push({ hash: level[siblingIndex], position: isLeft ? 'right' : 'left' })
    }
    i = Math.floor(i / 2)
  }
  return proof
}

export async function verifyChunk(chunkBuffer, proof, expectedRoot) {
  let current = await sha256Hex(chunkBuffer)
  for (const { hash: sibling, position } of proof) {
    current = position === 'right' ? await hashPair(current, sibling) : await hashPair(sibling, current)
  }
  return current === expectedRoot
}