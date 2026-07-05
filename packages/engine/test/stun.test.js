import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'dgram';
import {
  buildBindingRequest,
  parseBindingResponse,
  getReflexiveAddress,
  discoverReflexiveAddress,
  STUN_MAGIC_COOKIE,
  STUN_BINDING_RESPONSE,
  ATTR_XOR_MAPPED_ADDRESS,
} from '../src/net/stun.js';

function encodeXorMappedAddressResponse(transactionId, address, port) {
  const parts = address.split('.').map(Number);
  const addrNum = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const xport = port ^ (STUN_MAGIC_COOKIE >>> 16);
  const xaddr = (addrNum ^ STUN_MAGIC_COOKIE) >>> 0;

  const value = Buffer.alloc(8);
  value.writeUInt8(0, 0);
  value.writeUInt8(0x01, 1);
  value.writeUInt16BE(xport, 2);
  value.writeUInt32BE(xaddr, 4);

  const attr = Buffer.alloc(4 + value.length);
  attr.writeUInt16BE(ATTR_XOR_MAPPED_ADDRESS, 0);
  attr.writeUInt16BE(value.length, 2);
  value.copy(attr, 4);

  const header = Buffer.alloc(20);
  header.writeUInt16BE(STUN_BINDING_RESPONSE, 0);
  header.writeUInt16BE(attr.length, 2);
  header.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  transactionId.copy(header, 8);

  return Buffer.concat([header, attr]);
}

describe('stun', () => {
  test('parseBindingResponse decodes a hand-computed XOR-MAPPED-ADDRESS', () => {
    const transactionId = Buffer.alloc(12, 7);
    const response = encodeXorMappedAddressResponse(transactionId, '203.0.113.5', 54321);
    const result = parseBindingResponse(response, transactionId);
    assert.equal(result.address, '203.0.113.5');
    assert.equal(result.port, 54321);
  });

  test('parseBindingResponse rejects a mismatched transaction id', () => {
    const transactionId = Buffer.alloc(12, 1);
    const otherId = Buffer.alloc(12, 2);
    const response = encodeXorMappedAddressResponse(transactionId, '10.0.0.1', 1234);
    assert.throws(() => parseBindingResponse(response, otherId));
  });

  test('parseBindingResponse rejects a bad magic cookie', () => {
    const transactionId = Buffer.alloc(12, 3);
    const response = encodeXorMappedAddressResponse(transactionId, '10.0.0.1', 1234);
    response.writeUInt32BE(0, 4);
    assert.throws(() => parseBindingResponse(response, transactionId));
  });

  test('buildBindingRequest produces a well-formed 20-byte header', () => {
    const { buffer, transactionId } = buildBindingRequest();
    assert.equal(buffer.length, 20);
    assert.equal(buffer.readUInt16BE(0), 0x0001);
    assert.equal(buffer.readUInt32BE(4), STUN_MAGIC_COOKIE);
    assert.equal(transactionId.length, 12);
  });

  test('getReflexiveAddress resolves against a fake STUN server', async () => {
    const fakeServer = dgram.createSocket('udp4');
    fakeServer.on('message', (msg, rinfo) => {
      const transactionId = msg.subarray(8, 20);
      const response = encodeXorMappedAddressResponse(transactionId, '198.51.100.9', 40000);
      fakeServer.send(response, rinfo.port, rinfo.address);
    });

    await new Promise((resolve) => fakeServer.bind(0, '127.0.0.1', resolve));
    const { port } = fakeServer.address();

    try {
      const result = await getReflexiveAddress({ stunHost: '127.0.0.1', stunPort: port, timeoutMs: 2000 });
      assert.equal(result.address, '198.51.100.9');
      assert.equal(result.port, 40000);
    } finally {
      await new Promise((resolve) => fakeServer.close(resolve));
    }
  });

  test('getReflexiveAddress rejects on timeout when nothing responds', async () => {
    const deadServer = dgram.createSocket('udp4');
    await new Promise((resolve) => deadServer.bind(0, '127.0.0.1', resolve));
    const { port } = deadServer.address();

    try {
      await assert.rejects(
        getReflexiveAddress({ stunHost: '127.0.0.1', stunPort: port, timeoutMs: 150 }),
        /timed out/
      );
    } finally {
      await new Promise((resolve) => deadServer.close(resolve));
    }
  });

  test('discoverReflexiveAddress falls through a dead server to a working one', async () => {
    const workingServer = dgram.createSocket('udp4');
    workingServer.on('message', (msg, rinfo) => {
      const transactionId = msg.subarray(8, 20);
      const response = encodeXorMappedAddressResponse(transactionId, '203.0.113.77', 5555);
      workingServer.send(response, rinfo.port, rinfo.address);
    });
    await new Promise((resolve) => workingServer.bind(0, '127.0.0.1', resolve));
    const workingPort = workingServer.address().port;

    const deadServer = dgram.createSocket('udp4');
    await new Promise((resolve) => deadServer.bind(0, '127.0.0.1', resolve));
    const deadPort = deadServer.address().port;

    try {
      const result = await discoverReflexiveAddress(
        [
          { host: '127.0.0.1', port: deadPort },
          { host: '127.0.0.1', port: workingPort },
        ],
        { timeoutMs: 200 }
      );
      assert.equal(result.address, '203.0.113.77');
      assert.equal(result.port, 5555);
    } finally {
      await new Promise((resolve) => workingServer.close(resolve));
      await new Promise((resolve) => deadServer.close(resolve));
    }
  });
});
