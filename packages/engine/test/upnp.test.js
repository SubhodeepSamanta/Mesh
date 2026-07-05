import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'dgram';
import http from 'http';
import {
  discoverGateway,
  extractControlUrl,
  openPortMapping,
  closePortMapping,
  getExternalIpAddress,
} from '../src/net/upnp.js';

const DEVICE_DESCRIPTION = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType>
        <controlURL>/l3f</controlURL>
      </service>
    </serviceList>
    <deviceList>
      <device>
        <deviceList>
          <device>
            <serviceList>
              <service>
                <serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>
                <controlURL>/ctl/WANIPConn</controlURL>
              </service>
            </serviceList>
          </device>
        </deviceList>
      </device>
    </deviceList>
  </device>
</root>`;

async function startFakeIgd() {
  let lastAddPortMappingBody = null;
  const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/desc.xml') {
      res.writeHead(200, { 'content-type': 'text/xml' });
      res.end(DEVICE_DESCRIPTION);
      return;
    }
    if (req.method === 'POST' && req.url === '/ctl/WANIPConn') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const action = req.headers.soapaction || '';
        res.writeHead(200, { 'content-type': 'text/xml' });
        if (action.includes('GetExternalIPAddress')) {
          res.end('<s:Envelope><s:Body><u:GetExternalIPAddressResponse><NewExternalIPAddress>198.51.100.42</NewExternalIPAddress></u:GetExternalIPAddressResponse></s:Body></s:Envelope>');
        } else if (action.includes('AddPortMapping')) {
          lastAddPortMappingBody = body;
          res.end('<s:Envelope><s:Body><u:AddPortMappingResponse /></s:Body></s:Envelope>');
        } else if (action.includes('DeletePortMapping')) {
          res.end('<s:Envelope><s:Body><u:DeletePortMappingResponse /></s:Body></s:Envelope>');
        } else {
          res.end('<s:Envelope><s:Body /></s:Envelope>');
        }
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const httpPort = httpServer.address().port;

  const ssdpServer = dgram.createSocket('udp4');
  ssdpServer.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8');
    if (!/M-SEARCH/i.test(text)) return;
    const reply = Buffer.from(
      'HTTP/1.1 200 OK\r\n' +
        `LOCATION: http://127.0.0.1:${httpPort}/desc.xml\r\n` +
        'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n' +
        '\r\n'
    );
    ssdpServer.send(reply, rinfo.port, rinfo.address);
  });
  await new Promise((resolve) => ssdpServer.bind(0, '127.0.0.1', resolve));
  const ssdpPort = ssdpServer.address().port;

  return {
    ssdpHost: '127.0.0.1',
    ssdpPort,
    httpPort,
    getLastAddPortMappingBody: () => lastAddPortMappingBody,
    close: async () => {
      await new Promise((resolve) => ssdpServer.close(resolve));
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

describe('upnp', () => {
  test('extractControlUrl finds the WANIPConnection service nested under deviceList', () => {
    const { serviceType, controlUrl } = extractControlUrl(DEVICE_DESCRIPTION, 'http://192.168.1.1:1234/desc.xml');
    assert.equal(serviceType, 'urn:schemas-upnp-org:service:WANIPConnection:1');
    assert.equal(controlUrl, 'http://192.168.1.1:1234/ctl/WANIPConn');
  });

  test('extractControlUrl throws when no WAN service is present', () => {
    assert.throws(() => extractControlUrl('<root><device><serviceList></serviceList></device></root>', 'http://x/y'));
  });

  test('discoverGateway resolves the LOCATION header from a fake IGD', async () => {
    const igd = await startFakeIgd();
    try {
      const { location } = await discoverGateway({ ssdpHost: igd.ssdpHost, ssdpPort: igd.ssdpPort, timeoutMs: 2000 });
      assert.equal(location, `http://127.0.0.1:${igd.httpPort}/desc.xml`);
    } finally {
      await igd.close();
    }
  });

  test('openPortMapping walks discovery -> description -> SOAP AddPortMapping end to end', async () => {
    const igd = await startFakeIgd();
    try {
      const result = await openPortMapping({
        externalPort: 51413,
        internalPort: 51413,
        internalClient: '192.168.1.50',
        protocol: 'TCP',
        ssdp: { ssdpHost: igd.ssdpHost, ssdpPort: igd.ssdpPort },
        timeoutMs: 2000,
      });
      assert.equal(result.externalPort, 51413);
      assert.equal(result.serviceType, 'urn:schemas-upnp-org:service:WANIPConnection:1');
      const sentBody = igd.getLastAddPortMappingBody();
      assert.match(sentBody, /<NewExternalPort>51413<\/NewExternalPort>/);
      assert.match(sentBody, /<NewInternalClient>192\.168\.1\.50<\/NewInternalClient>/);
    } finally {
      await igd.close();
    }
  });

  test('closePortMapping reuses a previously resolved control URL without rediscovering', async () => {
    const igd = await startFakeIgd();
    try {
      await closePortMapping({
        externalPort: 51413,
        protocol: 'TCP',
        controlUrl: `http://127.0.0.1:${igd.httpPort}/ctl/WANIPConn`,
        serviceType: 'urn:schemas-upnp-org:service:WANIPConnection:1',
        timeoutMs: 2000,
      });
    } finally {
      await igd.close();
    }
  });

  test('getExternalIpAddress returns the router-reported public IP', async () => {
    const igd = await startFakeIgd();
    try {
      const ip = await getExternalIpAddress({ ssdp: { ssdpHost: igd.ssdpHost, ssdpPort: igd.ssdpPort }, timeoutMs: 2000 });
      assert.equal(ip, '198.51.100.42');
    } finally {
      await igd.close();
    }
  });

  test('openPortMapping rejects when no gateway responds', async () => {
    const deadSocket = dgram.createSocket('udp4');
    await new Promise((resolve) => deadSocket.bind(0, '127.0.0.1', resolve));
    const deadPort = deadSocket.address().port;
    try {
      await assert.rejects(
        openPortMapping({ externalPort: 1234, ssdp: { ssdpHost: '127.0.0.1', ssdpPort: deadPort }, timeoutMs: 150 })
      );
    } finally {
      await new Promise((resolve) => deadSocket.close(resolve));
    }
  });
});
