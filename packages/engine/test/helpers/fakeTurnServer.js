import dgram from 'dgram';
import { randomBytes, createHmac } from 'crypto';
import {
  MESSAGE_TYPE,
  ATTR,
  encodeMessage,
  decodeMessage,
  findAttr,
  encodeXorAddress,
  decodeXorAddress,
  encodeErrorCode,
  longTermKey,
  verifyMessageIntegrity,
  newTransactionId,
  uint32,
} from '../../src/net/stunMessage.js';

export function startFakeTurnServer({ secret, realm = 'mesh.test', forceStaleNonceOnce = false } = {}) {
  const socket = dgram.createSocket('udp4');
  let nonce = randomBytes(8).toString('hex');
  let staleNonceArmed = forceStaleNonceOnce;
  // one allocation (own relay socket + permission set) per client 5-tuple
  const allocations = new Map();

  function allocationKey(rinfo) {
    return `${rinfo.address}:${rinfo.port}`;
  }

  function challenge(type, transactionId, rinfo) {
    const errorType = type === MESSAGE_TYPE.ALLOCATE_REQUEST ? MESSAGE_TYPE.ALLOCATE_ERROR : MESSAGE_TYPE.CREATE_PERMISSION_ERROR;
    const attrs = [
      { type: ATTR.ERROR_CODE, value: encodeErrorCode(401, 'Unauthorized') },
      { type: ATTR.REALM, value: Buffer.from(realm) },
      { type: ATTR.NONCE, value: Buffer.from(nonce) },
    ];
    socket.send(encodeMessage(errorType, transactionId, attrs), rinfo.port, rinfo.address);
  }

  function staleNonce(type, transactionId, rinfo) {
    nonce = randomBytes(8).toString('hex');
    const errorType = type === MESSAGE_TYPE.ALLOCATE_REQUEST ? MESSAGE_TYPE.ALLOCATE_ERROR : MESSAGE_TYPE.CREATE_PERMISSION_ERROR;
    const attrs = [
      { type: ATTR.ERROR_CODE, value: encodeErrorCode(438, 'Stale Nonce') },
      { type: ATTR.REALM, value: Buffer.from(realm) },
      { type: ATTR.NONCE, value: Buffer.from(nonce) },
    ];
    socket.send(encodeMessage(errorType, transactionId, attrs), rinfo.port, rinfo.address);
  }

  socket.on('message', (msg, rinfo) => {
    const message = decodeMessage(msg);

    if (message.type === MESSAGE_TYPE.SEND_INDICATION) {
      const allocation = allocations.get(allocationKey(rinfo));
      const peerAttr = findAttr(message.attrs, ATTR.XOR_PEER_ADDRESS);
      const dataAttr = findAttr(message.attrs, ATTR.DATA);
      if (allocation && peerAttr && dataAttr) {
        const peer = decodeXorAddress(peerAttr);
        if (allocation.permissions.has(peer.address)) {
          allocation.relaySocket.send(dataAttr, peer.port, peer.address);
        }
      }
      return;
    }

    const usernameAttr = findAttr(message.attrs, ATTR.USERNAME);
    if (!usernameAttr) {
      if (message.type === MESSAGE_TYPE.REFRESH_REQUEST || message.type === MESSAGE_TYPE.ALLOCATE_REQUEST || message.type === MESSAGE_TYPE.CREATE_PERMISSION_REQUEST) {
        challenge(message.type, message.transactionId, rinfo);
      }
      return;
    }

    if (staleNonceArmed) {
      staleNonceArmed = false;
      staleNonce(message.type, message.transactionId, rinfo);
      return;
    }

    const username = usernameAttr.toString('utf8');
    const expectedCredential = createHmac('sha1', secret).update(username).digest('base64');
    const key = longTermKey(username, realm, expectedCredential);
    if (!verifyMessageIntegrity(message, key)) {
      challenge(message.type, message.transactionId, rinfo);
      return;
    }

    if (message.type === MESSAGE_TYPE.ALLOCATE_REQUEST) {
      const client = { address: rinfo.address, port: rinfo.port };
      const relaySocket = dgram.createSocket('udp4');
      const allocation = { client, relaySocket, permissions: new Set() };

      relaySocket.on('message', (data, peerRinfo) => {
        if (!allocation.permissions.has(peerRinfo.address)) return;
        const dataIndication = encodeMessage(MESSAGE_TYPE.DATA_INDICATION, newTransactionId(), [
          { type: ATTR.XOR_PEER_ADDRESS, value: encodeXorAddress(peerRinfo.address, peerRinfo.port) },
          { type: ATTR.DATA, value: data },
        ]);
        socket.send(dataIndication, client.port, client.address);
      });

      relaySocket.bind(0, '127.0.0.1', () => {
        allocations.set(allocationKey(rinfo), allocation);
        const attrs = [
          { type: ATTR.XOR_RELAYED_ADDRESS, value: encodeXorAddress('127.0.0.1', relaySocket.address().port) },
          { type: ATTR.XOR_MAPPED_ADDRESS, value: encodeXorAddress(rinfo.address, rinfo.port) },
          { type: ATTR.LIFETIME, value: uint32(600) },
        ];
        socket.send(encodeMessage(MESSAGE_TYPE.ALLOCATE_SUCCESS, message.transactionId, attrs), rinfo.port, rinfo.address);
      });
      return;
    }

    if (message.type === MESSAGE_TYPE.REFRESH_REQUEST) {
      const attrs = [{ type: ATTR.LIFETIME, value: uint32(600) }];
      socket.send(encodeMessage(MESSAGE_TYPE.REFRESH_SUCCESS, message.transactionId, attrs), rinfo.port, rinfo.address);
      return;
    }

    if (message.type === MESSAGE_TYPE.CREATE_PERMISSION_REQUEST) {
      const allocation = allocations.get(allocationKey(rinfo));
      const peerAttr = findAttr(message.attrs, ATTR.XOR_PEER_ADDRESS);
      const peer = decodeXorAddress(peerAttr);
      if (allocation) allocation.permissions.add(peer.address);
      socket.send(encodeMessage(MESSAGE_TYPE.CREATE_PERMISSION_SUCCESS, message.transactionId, []), rinfo.port, rinfo.address);
      return;
    }
  });

  return {
    ready: async () => {
      await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve));
      return { host: '127.0.0.1', port: socket.address().port };
    },
    close: async () => {
      for (const allocation of allocations.values()) {
        await new Promise((resolve) => allocation.relaySocket.close(resolve));
      }
      allocations.clear();
      await new Promise((resolve) => socket.close(resolve));
    },
  };
}
