# Mesh — Secure, Decentralized P2P File Sharing

Mesh is a secure, end-to-end encrypted, zero-server-storage peer-to-peer file and folder sharing platform. It operates entirely in the browser using WebRTC for direct data transfers, coordinated by a lightweight signaling server.

---

## 🚀 Key Features

*   **100% P2P Data Channels**: Files are streamed directly browser-to-browser. Your data never touches a server's disk or RAM.
*   **End-to-End Encrypted (E2EE)**: Direct WebRTC connections are secured using DTLS 1.3.
*   **Zero-RAM Streaming**: Utilizes the File System Access API to stream chunks directly to the receiver's disk, allowing transfers of multi-gigabyte files and folders without browser crashes.
*   **Cryptographic Integrity Verification**: Files are indexed and verified chunk-by-chunk in real-time using a Merkle Tree structure and SHA-256 hashes.
*   **Reseeding Capabilities**: Receivers who keep their transfer session open can act as seeders for late-joining peers.
*   **Password Protected Rooms**: Secure your room codes with optional SHA-256 password hashing.
*   **Dynamic TURN Credentials**: Automatic dynamic TURN credential generation from the signaling server protects your TURN secrets from being exposed on the frontend client bundle.

---

## 📦 Monorepo Workspaces

Mesh is structured as a monorepo containing:

1.  **`packages/web`**: React client built with Vite, Zustand, TailwindCSS, and D3/Peer-graphs.
2.  **`packages/signaling`**: Node.js WebSocket signaling server that coordinates WebRTC offers, answers, and ICE candidate relays.
3.  **`packages/engine`**: Core CLI/Node P2P engine utilizing DHT for CLI client routing.
4.  **`packages/cli`**: Node CLI tool for command-line file sharing.

---

## 🛠️ Quick Start

### Local Development

1.  **Install dependencies** in the root workspace:
    ```bash
    npm install
    ```

2.  **Start development servers**:
    ```bash
    npm run dev
    ```
    This launches the signaling server on port `8080` and the React web client on port `5173`.

3.  **Run tests**:
    ```bash
    npm test
    ```

---

## 🌐 Azure & Production VM Deployment

When hosting the signaling and TURN servers on a cloud VM (e.g. Azure Student VM, AWS EC2, GCP), follow these guidelines to ensure successful NAT traversal.

### 1. Docker Compose Configuration
Copy `.env.example` to `.env` in the root:
```bash
cp .env.example .env
```
Ensure the environment variables are set correctly:
*   `EXTERNAL_IP`: Set this to your VM's public IP address (crucial for `coturn`).
*   `TURN_SECRET`: Set this to a random secure string (used to generate dynamic time-limited credentials).

Run the services:
```bash
docker-compose up -d --build
```

### 2. Network Security Group (NSG) Configuration
For WebRTC peer connection establishment to succeed across cellular networks and symmetric NATs, you **must** open the following inbound ports on your Azure VM:

| Port / Range | Protocol | Purpose |
| :--- | :--- | :--- |
| `80` | TCP | HTTP / ACME SSL Challenge |
| `443` | TCP | HTTPS / Secure Websocket (WSS) |
| `3478` | UDP & TCP | TURN / STUN listener |
| `49152 - 65535` | UDP | TURN dynamic relay ports |

---

## 🔒 Production SSL Setup (Crucial)

Modern browsers enforce **Mixed Content** policies. If your React web client is served over HTTPS (which is default on platforms like Vercel, Netlify, or Github Pages), the browser **will block** WebSocket connections to an unencrypted signaling server (`ws://<IP>:8080`).

You **must** configure a reverse proxy with SSL (e.g., Caddy or Nginx with Let's Encrypt) on your Azure VM to serve the WebSocket server over a secure connection (`wss://`).

### Example Caddyfile Configuration
If you run Caddy on your VM, configuring SSL is as simple as:
```caddy
signaling.yourdomain.com {
    reverse_proxy /ws* localhost:8080
}
```
Then configure your web client's environment file (`.env`):
```env
VITE_SIGNALING_URL=wss://signaling.yourdomain.com/ws
```

---

## 🐛 Troubleshooting & Known Bugs

For details on currently identified integration bugs (e.g. single-chunk verification vulnerability, empty-file streaming issues, and UI connection recovery state freezing) and their exact fixes, please refer to the instruction file:

📄 **[instructions_for_claude.md](file:///c:/Users/USER/Desktop/mesh/instructions_for_claude.md)**
