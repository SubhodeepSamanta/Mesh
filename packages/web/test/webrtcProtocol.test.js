import { describe, it, expect } from 'vitest';
import { TYPE, MSG, buildJSONBody, buildChunkBody, parseMessage } from '../src/webrtc/protocol.js';

describe('webrtc binary protocol', () => {
  it('round trips a JSON message', () => {
    const body = buildJSONBody({ type: MSG.CHUNK_REQUEST, index: 42 });
    const parsed = parseMessage(body);
    expect(parsed.type).toBe(TYPE.JSON);
    expect(parsed.data).toEqual({ type: MSG.CHUNK_REQUEST, index: 42 });
  });

  it('round trips a chunk message including binary data', () => {
    const chunkData = new Uint8Array([1, 2, 3, 4, 5, 250, 251]);
    const hash = 'a'.repeat(64);
    const proof = [{ hash: 'b'.repeat(64), position: 'right' }];

    const body = buildChunkBody(7, hash, proof, chunkData);
    const parsed = parseMessage(body);

    expect(parsed.type).toBe(TYPE.CHUNK);
    expect(parsed.chunkIndex).toBe(7);
    expect(parsed.chunkHash).toBe(hash);
    expect(parsed.proof).toEqual(proof);
    expect(new Uint8Array(parsed.chunkData)).toEqual(chunkData);
  });
});