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

const OWNER_CARD = `
  mesh v${pkg.version} — built by Subhodeep Samanta

  Portfolio   https://subhodeepsamanta.github.io/
  GitHub      https://github.com/SubhodeepSamanta
  LinkedIn    https://www.linkedin.com/in/subhodeepsamanta/
  Email       subhodeepsamanta2005@gmail.com

  Source      https://github.com/SubhodeepSamanta/Mesh
  Web app     https://mesh-share.vercel.app
`;

// `mesh --owner` (no subcommand) — handled before commander parses.
if (process.argv[2] === '--owner') {
  console.log(OWNER_CARD);
  process.exit(0);
}

const program = new Command();
program
  .name('mesh')
  .description('Decentralised peer-to-peer file transfer over a Kademlia DHT')
  .version(pkg.version, '-v, --version', 'print the installed mesh version')
  .addHelpText('after', `
Examples:
  $ mesh send movie.mp4                        seed a file, get a share code
  $ mesh receive AIB2ZROQMUH2DQF...            download it on any machine
  $ mesh receive AIB2ZROQ... --out ~/dl/a.mp4  choose where the file lands
  $ mesh receive AIB2ZROQ... --seed            keep seeding after download
  $ mesh diagnose                              what can your NAT do?
  $ mesh daemon --dht-port 4001                run a DHT bootstrap node (VPS)
  $ mesh owner                                 who built this

Run 'mesh <command> --help' for every flag with worked examples,
e.g. 'mesh send --help' or 'mesh receive --help'.

Interrupted transfers resume: Ctrl+C checkpoints to a .meshstate sidecar —
re-run the exact same receive command to continue from the last verified chunk.`);

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
  .addHelpText('after', `
Examples:
  $ mesh send movie.mp4
      Zero flags — joins the public mesh DHT, fetches short-lived TURN relay
      credentials automatically, prints a share code, and seeds until Ctrl+C.

  $ mesh send big.iso --port 5000 --dht-port 4001
      Pin the TCP chunk port and the UDP DHT port (useful when you have
      forwarded those ports on your router manually).

  $ mesh send movie.mp4 --public-ip 203.0.113.7 --no-upnp --no-stun
      VPS with a static public IP — skip all address discovery.

  $ mesh send movie.mp4 --bootstrap 203.0.113.7:4001 --turn-host 203.0.113.7 --turn-secret s3cret
      Fully self-hosted: your own DHT bootstrap node and coturn relay.

  $ mesh send notes.pdf --no-turn --no-tui
      LAN-only transfer with plain log output (good for scripts and CI).

Environment variables (flags win over these):
  MESH_BOOTSTRAP    default DHT bootstrap node, host:port
  MESH_TURN_API     URL returning { iceServers } TURN credentials
  MESH_TURN_HOST / MESH_TURN_PORT / MESH_TURN_SECRET   your own coturn
  MESH_PUBLIC_IP    skip discovery and announce this address`)
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
  .addHelpText('after', `
Examples:
  $ mesh receive AIB2ZROQMUH2DQFILAA5AURPD...
      Download to the sender's original filename in the current directory.
      Spaces/dashes in the code are fine — paste it however it was shared.

  $ mesh receive AIB2ZROQ... --out ~/Downloads/movie.mp4
      Choose exactly where the file lands (avoid pointing --out at a file
      you are seeding from the same directory — it would overwrite it).

  $ mesh receive AIB2ZROQ... --seed
      Keep serving verified chunks to other peers after your download
      completes, BitTorrent-style (Ctrl+C to stop).

  $ mesh receive AIB2ZROQ... --no-tui
      Plain percentage log output for scripts, CI, or narrow terminals.

Resume: Ctrl+C mid-download checkpoints progress to a .meshstate sidecar.
Run the exact same command again and it continues from the last verified
chunk — even hours later, even if the sender's address changed.`)
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
  .addHelpText('after', `
Examples:
  $ mesh daemon
      Listen on UDP 4001. Open that port in your firewall / cloud NSG,
      then point clients at it with --bootstrap <your-ip>:4001.

  $ mesh daemon --dht-port 5001
      Use a different UDP port.

Tip: on a VPS, run it under systemd (or nohup) so it survives reboots.`)
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
  .addHelpText('after', `
Reports your LAN IP, whether your router accepts UPnP port mappings, and
your STUN-observed public address — i.e. whether peers will reach you
directly or fall back to the TURN relay tier.

Example:
  $ mesh diagnose`)
  .action(async () => {
    try {
      await diagnoseCommand();
    } catch (e) {
      console.error(`Error: ${e.message}`);
      process.exitCode = 1;
    }
  });

program
  .command('owner')
  .alias('author')
  .description('Show who built mesh — links and contact')
  .action(() => {
    console.log(OWNER_CARD);
  });

program.parseAsync(process.argv);
