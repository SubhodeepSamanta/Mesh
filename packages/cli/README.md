<div align="center">

# ⬡ mesh

**Send a file from one terminal to another — anywhere on Earth. No accounts, no upload servers, no configuration.**

[![npm](https://img.shields.io/npm/v/mesh-share?color=cb3837&logo=npm)](https://www.npmjs.com/package/mesh-share)
[![runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen)](https://github.com/SubhodeepSamanta/Mesh/blob/main/packages/cli/package.json)
[![node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=nodedotjs&logoColor=white)](https://github.com/SubhodeepSamanta/Mesh)
[![source](https://img.shields.io/badge/source-GitHub-181717?logo=github)](https://github.com/SubhodeepSamanta/Mesh)
[![web version](https://img.shields.io/badge/browser%20version-mesh--share.vercel.app-black?logo=vercel)](https://mesh-share.vercel.app)

</div>

```bash
npm install -g mesh-share
```

```bash
# machine A
$ mesh send movie.mp4

  Share this code with the receiver:
  AIB2Z-ROQMU-H2DQF-ILAA5-AURPD-YNNPU-...

# machine B — any network, any country
$ mesh receive AIB2ZROQMUH2DQFILAA5AURPD...
  [██████████████████████████████] 100.0%   ✔ saved to movie.mp4
```

![mesh send](https://raw.githubusercontent.com/SubhodeepSamanta/Mesh/main/screenshots/06-cli-send.png)
![mesh receive](https://raw.githubusercontent.com/SubhodeepSamanta/Mesh/main/screenshots/07-cli-receive.png)

## What makes it different

Two `mesh` processes find each other over a **Kademlia DHT** and transfer the file **directly**, end-to-end encrypted, verifying every chunk against a Merkle proof. The entire network stack is implemented from scratch in this package — which is why `npm install` pulls **zero runtime dependencies**:

- 🕸 **Kademlia DHT** for peer discovery — the share code is self-contained (peer addresses + the file's SHA-256 Merkle root); no server interprets it
- 🔓 **NAT traversal ladder** — direct TCP → automatic UPnP port-mapping → TURN relay fallback, tried in order, automatically
- 🔐 **End-to-end encryption** — ephemeral X25519 key exchange, HKDF, AES-256-GCM; relays only ever see ciphertext
- ✅ **Cryptographic integrity** — every chunk ships with a Merkle proof chained to the root embedded in the share code; corrupt or malicious data is rejected and re-fetched
- 🚦 **Reliable transport over UDP** — hand-written sliding-window ARQ when relaying
- ⏸ **Pause / resume** — `Ctrl+C` checkpoints progress to a `.meshstate` sidecar; run the same command again to continue
- 🌱 **Chain seeding** — `--seed` keeps serving after your download completes, so swarms grow like BitTorrent
- 📦 **One-file install** — the published package is a single bundled script (~500 kB, 3 files)

## Commands

| Command | Purpose |
|---|---|
| `mesh send <file>` | Index, seed, and print a share code. Keeps serving until Ctrl+C |
| `mesh receive <code>` | Discover, connect (direct or relayed), download with per-chunk verification |
| `mesh receive <code> --out <path>` | Choose where the file lands |
| `mesh receive <code> --seed` | Keep seeding to other peers after your download finishes |
| `mesh daemon` | Run a public DHT bootstrap node (for self-hosters, e.g. on a VPS) |
| `mesh diagnose` | Report LAN IP, STUN-observed public IP, and UPnP support |

## Zero-flag by design

`mesh send ./file` just works: the package ships a default public DHT bootstrap node (the same way BitTorrent clients ship default DHT routers) and fetches short-lived TURN relay credentials automatically — **no secret is embedded in this package**. Everything is overridable for self-hosting:

| Flag | Env var | Purpose |
|---|---|---|
| `--bootstrap <host:port>` | `MESH_BOOTSTRAP` | Use your own DHT bootstrap node (`--no-bootstrap` to join none) |
| `--turn-host / --turn-port / --turn-secret` | `MESH_TURN_HOST / _PORT / _SECRET` | Use your own coturn (`--no-turn` disables the relay tier) |
| — | `MESH_TURN_API` | URL returning `{ iceServers }` credentials (like the signaling server's `/turn`) |
| `--public-ip <ip>` | `MESH_PUBLIC_IP` | Skip discovery; announce this address (VPS with static IP) |
| `--port / --dht-port` | — | Pin the TCP transfer / UDP DHT ports |
| `--no-upnp / --no-stun / --no-tui` | — | Disable router mapping / public-IP discovery / the fancy terminal UI |

## How a transfer actually works

1. **`mesh send`** streams the file once, hashing every chunk (adaptive 64 kB–32 MB) into a **Merkle tree** — the root becomes the file's identity.
2. It works out how the world can reach it: **UPnP** mapping if your router allows, otherwise **STUN** for your public address, plus a **TURN allocation** as the guaranteed fallback — then announces itself on the DHT every 25 s.
3. The **share code** encodes up to 4 address candidates + the 32-byte Merkle root in base32. It is not a lookup key — it *is* the connection information.
4. **`mesh receive`** bootstraps into the DHT from those candidates, finds all seeders in `O(log N)` hops, and climbs the connection ladder per peer: parallel direct dials first, encrypted relay-to-relay through TURN if both sides are NATed.
5. Chunks download **pipelined across up to 30 seeders**; each is decrypted, hash-checked, and Merkle-verified before being written at its exact offset. Peers serving bad data get five strikes, then eviction.

## Requirements

Node.js 18+. Windows, macOS, Linux.

## The bigger project

This CLI is half of **mesh** — there's also a browser version at **[mesh-share.vercel.app](https://mesh-share.vercel.app)** (WebRTC, same Merkle verification, streams multi-GB files to disk, plays videos while they download). Source, architecture docs, and the signaling/TURN deployment for self-hosting live in the monorepo:

**→ [github.com/SubhodeepSamanta/Mesh](https://github.com/SubhodeepSamanta/Mesh)**

ISC © Subhodeep Samanta
