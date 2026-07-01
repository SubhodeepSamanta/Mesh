import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { saveResumeState, loadResumeState, deleteResumeState, resumeStateMatches } from '../src/resume.js';

describe('resume state', () => {
  it('returns null when no state file exists', async () => {
    const outputPath = join(tmpdir(), `mesh-resume-none-${Date.now()}.bin`);
    const state = await loadResumeState(outputPath);
    assert.equal(state, null);
  });

  it('saves and loads a state file round trip', async () => {
    const outputPath = join(tmpdir(), `mesh-resume-${Date.now()}.bin`);
    const original = {
      fileHash: 'a'.repeat(64),
      fileSize: 1024,
      totalChunks: 10,
      chunkSize: 64,
      merkleRoot: 'a'.repeat(64),
      completedChunks: [0, 1, 2, 5],
    };
    await saveResumeState(outputPath, original);
    const loaded = await loadResumeState(outputPath);
    assert.equal(loaded.fileHash, original.fileHash);
    assert.deepEqual(loaded.completedChunks, original.completedChunks);
    await deleteResumeState(outputPath);
  });

  it('deleteResumeState removes the file and is safe to call when absent', async () => {
    const outputPath = join(tmpdir(), `mesh-resume-del-${Date.now()}.bin`);
    await saveResumeState(outputPath, {
      fileHash: 'b'.repeat(64), fileSize: 1, totalChunks: 1, chunkSize: 1,
      merkleRoot: 'b'.repeat(64), completedChunks: [],
    });
    await deleteResumeState(outputPath);
    const loaded = await loadResumeState(outputPath);
    assert.equal(loaded, null);
    await deleteResumeState(outputPath);
  });

  it('resumeStateMatches validates matching and mismatched state correctly', () => {
    const state = {
      fileHash: 'c'.repeat(64), fileSize: 1024, totalChunks: 10,
      chunkSize: 64, merkleRoot: 'c'.repeat(64), completedChunks: [0],
    };
    assert.equal(resumeStateMatches(state, {
      fileHash: 'c'.repeat(64), fileSize: 1024, totalChunks: 10, chunkSize: 64, merkleRoot: 'c'.repeat(64),
    }), true);
    assert.equal(resumeStateMatches(state, {
      fileHash: 'c'.repeat(64), fileSize: 999, totalChunks: 10, chunkSize: 64, merkleRoot: 'c'.repeat(64),
    }), false);
    assert.equal(resumeStateMatches(null, {
      fileHash: 'c'.repeat(64), fileSize: 1024, totalChunks: 10, chunkSize: 64, merkleRoot: 'c'.repeat(64),
    }), false);
  });
});