# Mesh Web Client

Mesh is a secure, end-to-end encrypted peer-to-peer file transfer web client that runs entirely in the browser using WebRTC.

## Configuration & Environment Variables

Create a `.env` file in this directory or set the variables in your environment:

- `VITE_SIGNALING_URL`: The WebSocket URL of the signaling server (e.g., `ws://localhost:8080` for local dev, `wss://mesh-signaling.onrender.com` for production).
- `VITE_STUN_URL`: The STUN server URL used to gather WebRTC candidates (defaults to Google's public STUN server).
- `VITE_TURN_URL`: The TURN server URL required for symmetric NAT / CGNAT / mobile carriers bypass.
- `VITE_TURN_USERNAME`: Username for the TURN server authentication.
- `VITE_TURN_CREDENTIAL`: Credential/password for the TURN server authentication.

> [!WARNING]
> Hardcoding long-lived TURN credentials directly in the front-end build can expose them to theft. For production deployments, it is recommended to dynamically request short-lived HMAC credentials from your signaling/backend server.

## Features & Implementation Notes

- **End-to-End Encryption**: DTLS keys are negotiated directly peer-to-peer; no signaling server has access to file contents.
- **Merkle Tree Chunk Verification**: Files are indexed and split into chunks. Each received chunk is dynamically verified against a Merkle root hash tree.
- **Reseeding**: Receivers who complete a download can act as seeders (reseeding), provided the download was held in-memory (Merkle tree rebuilt successfully).

## Known Limitations

- **Sender Progress**: When multiple receivers are active simultaneously, the sender's upload progress reflects the aggregate chunk serving state rather than individual receiver percentages.
- **Reseeding with Streamed Folders**: For large file transfers or directory streaming directly to the disk/filesystem, reseeding is disabled. Rebuilding the Merkle tree for verification would require reading back all written file chunks from the disk, defeating the performance benefits of direct streaming.
- **Background Tab State**: Because mobile browsers and modern desktop browsers heavily throttle timers and CPU in background tabs, both the sender and receiver pages should remain open and in the foreground for optimal transfer speed.
