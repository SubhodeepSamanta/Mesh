import { readFile, writeFile, rename, unlink } from 'fs/promises';

export const RESUME_STATE_VERSION = 1;

export function stateFilePath(outputPath) {
  return `${outputPath}.meshstate`;
}

export async function loadResumeState(outputPath) {
  const statePath = stateFilePath(outputPath);
  try {
    const raw = await readFile(statePath, 'utf8');
    const state = JSON.parse(raw);
    if (state.version !== RESUME_STATE_VERSION) return null;
    return state;
  } catch {
    return null;
  }
}

export async function saveResumeState(outputPath, state) {
  const statePath = stateFilePath(outputPath);
  const tmpPath = `${statePath}.tmp`;
  const payload = JSON.stringify({ version: RESUME_STATE_VERSION, ...state });
  await writeFile(tmpPath, payload, 'utf8');
  await rename(tmpPath, statePath);
}

export async function deleteResumeState(outputPath) {
  const statePath = stateFilePath(outputPath);
  await unlink(statePath).catch(() => {});
}

export function resumeStateMatches(state, { fileHash, totalChunks, chunkSize, merkleRoot, fileSize }) {
  if (!state) return false;
  return (
    state.fileHash === fileHash &&
    state.totalChunks === totalChunks &&
    state.chunkSize === chunkSize &&
    state.merkleRoot === merkleRoot &&
    state.fileSize === fileSize
  );
}