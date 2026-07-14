#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { sendCommand } from './commands/send.js';
import { receiveCommand } from './commands/receive.js';
import { diagnoseCommand } from './commands/diagnose.js';
import { daemonCommand } from './commands/daemon.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

function tuiEnabled(options) {
  return Boolean(process.stdout.isTTY) && options.tui !== false;
}

const program = new Command();
program
  .name('mesh')
  .description('Decentralised peer-to-peer file transfer over a Kademlia DHT')
  .version(pkg.version);

program
  .command('send <file>')
  .description('Seed a file and print a share code for the receiver')
  .option('--port <port>', 'TCP port to serve chunks on (default: random)')
  .option('--dht-port <port>', 'UDP port for the DHT node (default: random)')
  .option('--bootstrap <hostport>', 'DHT bootstrap node, format host:port (default: the public mesh bootstrap node)')
  .option('--no-bootstrap', 'do not join any existing DHT (receivers must reach this machine directly)')
  .option('--public-ip <ip>', 'override public IP detection')
  .option('--no-upnp', 'skip automatic UPnP port mapping')
  .option('--no-stun', 'skip STUN public-IP discovery')
  .option('--turn-host <host>', 'TURN relay server host (default: credentials fetched from the public mesh relay)')
  .option('--turn-port <port>', 'TURN relay server port', '3478')
  .option('--turn-secret <secret>', 'TURN static-auth-secret, shared with the coturn deployment')
  .option('--no-turn', 'disable the TURN relay fallback tier')
  .option('--no-tui', 'disable the interactive terminal UI and use plain log output')
  .action(async (file, options) => {
    let tuiInstance = null;
    try {
      const session = await sendCommand(file, options, {
        log: console.log,
        onSeedReady: async (summary) => {
          if (tuiEnabled(options)) {
            const { renderSendTUI } = await import('./ui/TransferTUI.js');
            tuiInstance = renderSendTUI(summary);
            return;
          }
          console.log(`\nSeeding: ${summary.fileName} (${(summary.fileSize / 1024 / 1024).toFixed(2)} MB, ${summary.totalChunks} chunks)`);
          console.log(`Connectivity: ${summary.connectivity}${summary.turnConfigured ? ' + TURN relay configured' : ''}`);
          console.log(`\nShare this code with the receiver:\n\n  ${summary.shareCodeFormatted}\n`);
          console.log(`On the other machine: mesh receive ${summary.shareCode}`);
          console.log('\nWaiting for peers... (Ctrl+C to stop seeding)');
        },
      });

      process.on('SIGINT', async () => {
        if (tuiInstance) tuiInstance.unmount();
        console.log('\nStopping...');
        await session.stop();
        process.exit(0);
      });
    } catch (e) {
      if (tuiInstance) tuiInstance.unmount();
      console.error(`Error: ${e.message}`);
      process.exitCode = 1;
    }
  });

program
  .command('receive <code>')
  .description('Download a file using a share code from mesh send')
  .option('--out <path>', 'output file path (default: sender-provided filename in the current directory)')
  .option('--seed', 'keep seeding the file to other peers after the download completes')
  .option('--no-upnp', 'skip automatic UPnP port mapping when re-seeding with --seed')
  .option('--no-stun', 'skip STUN public-IP discovery when re-seeding with --seed')
  .option('--no-tui', 'disable the interactive terminal UI and use plain log output')
  .action(async (code, options) => {
    let tuiInstance = null;
    let lastPercent = -1;

    try {
      const result = await receiveCommand(code, options, {
        onSwarmReady: async (swarm, meta) => {
          if (tuiEnabled(options)) {
            const { renderReceiveTUI } = await import('./ui/TransferTUI.js');
            const fileLabel = meta.outputPath ? basename(meta.outputPath) : 'incoming file';
            tuiInstance = renderReceiveTUI({ fileLabel, swarm });
            return;
          }

          swarm.on('chunkVerified', ({ verified, total }) => {
            const pct = Math.floor((verified / total) * 100);
            if (pct !== lastPercent) {
              lastPercent = pct;
              process.stdout.write(`\rDownloading... ${pct}% (${verified}/${total} chunks)   `);
            }
          });
          swarm.on('peerConnected', ({ peerId, tier }) => {
            console.log(`\nConnected to peer ${peerId} via ${tier} tier`);
          });
          swarm.on('connectionWarnings', (warnings) => {
            console.warn(`\nSkipped ${warnings.length} unreachable peer listing(s)`);
          });
          swarm.on('retrying', ({ attempt, verified, total }) => {
            console.warn(`\nConnection lost — reconnecting (attempt ${attempt}, ${verified}/${total} chunks kept)...`);
          });
        },
      });

      if (tuiInstance) {
        tuiInstance.unmount();
      } else {
        process.stdout.write('\n');
      }

      if (result.status === 'complete') {
        console.log(`Done: saved to ${result.outputPath}`);
        if (result.seeding) {
          console.log('Now seeding this file to other peers (Ctrl+C to stop).');
          process.on('SIGINT', async () => {
            console.log('\nStopping...');
            await result.seedManager.stopAll();
            await result.dhtNode.close();
            process.exit(0);
          });
        } else {
          process.exit(0);
        }
      } else if (result.status === 'paused') {
        console.log(`Paused at ${result.verifiedChunks}/${result.totalChunks} chunks. Run the same command again to resume.`);
        process.exit(0);
      }
    } catch (e) {
      if (tuiInstance) tuiInstance.unmount();
      console.error(`Error: ${e.message}`);
      process.exitCode = 1;
    }
  });

program
  .command('daemon')
  .description('Run a standalone DHT bootstrap node (e.g. on a public VPS) that helps NATed peers find each other')
  .option('--dht-port <port>', 'UDP port to listen on', '4001')
  .action(async (options) => {
    try {
      const daemon = await daemonCommand(options);
      process.on('SIGINT', async () => {
        console.log('\nStopping...');
        await daemon.stop();
        process.exit(0);
      });
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exitCode = 1;
    }
  });

program
  .command('diagnose')
  .description('Check NAT traversal capability (UPnP, STUN, local network)')
  .action(async () => {
    try {
      await diagnoseCommand();
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
