import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { writeFile, mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = join(__dirname, '..', 'src', 'index.js');

function runCli(args) {
  const child = spawn(process.execPath, [CLI_ENTRY, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  return { child, getStdout: () => stdout, getStderr: () => stderr };
}

function waitForExit(child) {
  return new Promise((resolve) => child.on('exit', (code) => resolve(code)));
}

async function waitForShareCode(sender, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const match = sender.getStdout().match(/mesh receive (\S+)/);
    if (match) return match[1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for share code. stdout so far: ${sender.getStdout()} stderr: ${sender.getStderr()}`);
}

describe('mesh send/receive CLI integration', () => {
  test('sends and receives a file byte-for-byte identical via a real DHT + TCP transfer', { timeout: 25000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mesh-cli-it-'));
    const srcPath = join(dir, 'source.bin');
    const outPath = join(dir, 'received.bin');
    const content = randomBytes(300000);

    try {
      await writeFile(srcPath, content);

      const sender = runCli(['send', srcPath, '--public-ip', '127.0.0.1', '--no-upnp', '--no-stun', '--no-bootstrap', '--no-turn']);
      const shareCode = await waitForShareCode(sender);

      const receiver = runCli(['receive', shareCode, '--out', outPath]);
      const receiverExitCode = await waitForExit(receiver.child);

      assert.equal(receiverExitCode, 0, `receiver exited with ${receiverExitCode}: ${receiver.getStderr()}`);
      assert.match(receiver.getStdout(), /Done: saved to/);

      const result = await readFile(outPath);
      assert.ok(result.equals(content));

      sender.child.kill();
      await waitForExit(sender.child);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('receiving with a garbage share code fails fast with a clear error', { timeout: 10000 }, async () => {
    const receiver = runCli(['receive', 'NOT-A-REAL-CODE']);
    const exitCode = await waitForExit(receiver.child);

    assert.notEqual(exitCode, 0);
    assert.match(receiver.getStderr(), /Error:/);
  });

  test('receiving a well-formed code for an unreachable sender fails with a clear error', { timeout: 15000 }, async () => {
    const { encodeShareCode } = await import('../src/lib/shareCode.js');
    const fakeCode = encodeShareCode({ fileHash: 'a'.repeat(64), candidates: [{ host: '127.0.0.1', port: 1 }] });

    const receiver = runCli(['receive', fakeCode]);
    const exitCode = await waitForExit(receiver.child);

    assert.notEqual(exitCode, 0);
    assert.match(receiver.getStderr(), /Could not reach sender/);
  });

  test('--no-upnp and --no-stun actually suppress UPnP/STUN through real commander parsing (regression: option name mismatch)', { timeout: 15000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mesh-cli-flags-'));
    const srcPath = join(dir, 'source.bin');

    try {
      await writeFile(srcPath, randomBytes(1000));

      const sender = runCli(['send', srcPath, '--no-upnp', '--no-stun', '--no-bootstrap', '--no-turn']);
      await waitForShareCode(sender);

      assert.match(sender.getStdout(), /Connectivity: local/);
      assert.doesNotMatch(sender.getStdout(), /Connectivity: (stun|upnp)/);

      sender.child.kill();
      await waitForExit(sender.child);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
