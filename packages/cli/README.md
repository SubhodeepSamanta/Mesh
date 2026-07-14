# mesh

Decentralised, serverless peer-to-peer file transfer from your terminal. No accounts, no upload servers, no signaling server — two `mesh` processes find each other over a Kademlia DHT and transfer the file directly, encrypted end to end.

```
mesh send ./movie.mp4
mesh receive <share-code>
```

## Install

```
npm install -g mesh-share
```

This installs the `mesh` command globally.

## Usage

### Send a file

```
mesh send ./path/to/file
```

This indexes the file, starts a local DHT node, opens a TCP listener to serve chunks, and prints a share code:

```
Share this code with the receiver:

  AF7QA-AAB5I-SVYDT-JYJRJ-WXJOY-4SNOD-...

On the other machine: mesh receive AF7QAAAB5ISVYDTJYJRJWXJOY4SNOD...
```

The process keeps running and seeding the file until you press Ctrl+C. The share code embeds the file's content hash and your machine's DHT address — the receiver bootstraps directly against it, no separate rendezvous server involved.

Useful flags:

| Flag | Purpose |
|---|---|
| `--public-ip <ip>` | Skip auto-detection and announce this IP directly (useful on a VPS with a known static IP) |
| `--no-upnp` | Skip automatic router port-mapping |
| `--no-stun` | Skip public-IP discovery via STUN |
| `--turn-host`, `--turn-port`, `--turn-secret` | Configure a TURN relay fallback (see below) |
| `--port`, `--dht-port` | Pin specific TCP/UDP ports instead of random ones |

The TURN flags can also be set as environment variables instead of typing them every time — `MESH_TURN_HOST`, `MESH_TURN_PORT`, `MESH_TURN_SECRET`, and `MESH_PUBLIC_IP`. Use the same values as your `coturn` deployment's `TURN_SECRET`/`EXTERNAL_IP` (see the root `.env`):

```
export MESH_TURN_HOST=your-vm-ip
export MESH_TURN_SECRET=your-turn-secret
mesh send ./file
```

### Receive a file

```
mesh receive <share-code>
```

Downloads the file into the current directory (or `--out <path>`), verifying every chunk against a Merkle proof of the sender's content hash. Pass `--seed` to keep serving the file to other peers after your own download completes (chain-seeding).

Ctrl+C pauses a transfer safely — chunks already verified are checkpointed to a `.meshstate` sidecar file, so re-running the same `mesh receive` command resumes instead of starting over.

### Check your connectivity

```
mesh diagnose
```

Reports your local IP, STUN-observed public IP, and whether your router supports UPnP automatic port-mapping — useful for predicting whether `mesh send` will be directly reachable from the open internet.

## How connectivity works

Two peers connect through a three-tier ladder, attempted in order:

1. **Direct** — the receiver dials the sender's TCP port directly.
2. **UPnP-assisted direct** — if the sender's router supports UPnP, `mesh send` automatically opens a port mapping so tier 1 works even behind typical home NAT.
3. **TURN relay** — if direct connection fails and a TURN server is configured (`--turn-host`/`--turn-secret`), traffic relays through it. This is the same coturn deployment and HMAC credential scheme used by the browser client, just driven by a small built-in TURN client instead of WebRTC.

Every tier carries the same end-to-end encryption (X25519 ECDH + AES-256-GCM) and the same Merkle-proof chunk verification — the relay only ever sees ciphertext.

## Why the share code is long

Unlike a signaling-server room code, the share code has no server behind it — it's a self-contained token encoding the full 256-bit file hash plus your DHT bootstrap address. That's a deliberate trade-off for zero infrastructure: copy-paste it once, and it works from any terminal, no account or server dependency involved.

## Requirements

Node.js 18 or later.
