# Mesh — P2P File Transfer Monorepo

Mesh is a secure, end-to-end encrypted, zero-server-storage peer-to-peer file and folder transfer application. It uses WebRTC for direct browser-to-browser data transfer and a lightweight signaling server for initial connection coordination.

## Monorepo Workspaces

This repository is structured as a monorepo containing two main packages:

1. **`packages/web`**: The frontend React client built with Vite, utilizing Zustand for state management, TailwindCSS + custom themes, and D3 for peer connection graph visualization.
2. **`packages/signaling`**: The Node.js WebSocket-based signaling server that routes WebRTC connection offers/answers between peers securely.

## Quick Start

### Local Development

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start Development Servers**:
   Run the dev command from the root to launch both the signaling server and the web client simultaneously:
   ```bash
   npm run dev
   ```

3. **Run Tests**:
   Run the test suite across all packages:
   ```bash
   npm test
   ```

### Docker Deployment & TURN Configuration

For NAT traversal across different networks (e.g. mobile networks or symmetric NATs on phones), a TURN server is required. A pre-configured `docker-compose.yml` is provided at the root which runs both the signaling server and a self-hosted `coturn` TURN server:

1. **Configure Environment**:
   Copy `.env.example` to `.env` in the root:
   ```bash
   cp .env.example .env
   ```
   For production NAT traversal, you **must** configure the following variables in `.env`:
   * `EXTERNAL_IP`: Set this to your host server's public IP address (mandatory for coturn NAT traversal).
   * `TURN_SECRET`: Set this to a random secure string. The signaling server uses this to generate secure, time-limited TURN credentials dynamically.

2. **Start Services**:
   ```bash
   docker-compose up -d --build
   ```

The signaling server automatically generates and relays WebRTC configurations containing dynamic TURN server details to connecting clients, allowing peer connections to succeed across symmetric firewalls.

## Architecture & Design Decisions

- **E2EE DTLS Connection**: WebRTC data channels are encrypted using DTLS.
- **Merkle Tree Proofs**: Prevents untrusted seeders (or bad actors joining a room) from serving modified chunks.
- **Streaming Files**: Utilizes the File System Access API where available to stream files directly to the receiver's disk, keeping RAM consumption flat regardless of file size.
- **Throughput Backpressure**: Implemented in `webrtc.js` using `bufferedAmountLow` event to prevent data buffer overflows on slower networks.
