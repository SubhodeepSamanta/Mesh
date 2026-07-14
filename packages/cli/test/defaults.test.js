import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { fetchTurnCredentials } from '../src/lib/defaults.js';

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('fetchTurnCredentials', () => {
  it('parses host, port and credentials out of an iceServers response', async () => {
    const server = await serve((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        iceServers: [
          { urls: 'stun:stun.example.org:19302' },
          { urls: 'turn:198.51.100.7:3478', username: '123:abc', credential: 'topsecret' },
        ],
      }));
    });

    try {
      const creds = await fetchTurnCredentials(`http://127.0.0.1:${server.address().port}/turn`);
      assert.deepEqual(creds, { host: '198.51.100.7', port: 3478, username: '123:abc', credential: 'topsecret' });
    } finally {
      server.close();
    }
  });

  it('defaults the port to 3478 when the turn: url omits it', async () => {
    const server = await serve((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        iceServers: [{ urls: 'turn:relay.example.org', username: 'u', credential: 'c' }],
      }));
    });

    try {
      const creds = await fetchTurnCredentials(`http://127.0.0.1:${server.address().port}/turn`);
      assert.equal(creds.host, 'relay.example.org');
      assert.equal(creds.port, 3478);
    } finally {
      server.close();
    }
  });

  it('rejects when the response has no usable TURN entry', async () => {
    const server = await serve((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ iceServers: [{ urls: 'stun:stun.example.org' }] }));
    });

    try {
      await assert.rejects(
        fetchTurnCredentials(`http://127.0.0.1:${server.address().port}/turn`),
        /no TURN credentials/
      );
    } finally {
      server.close();
    }
  });
});
