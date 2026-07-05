import dgram from 'dgram';
import http from 'http';
import os from 'os';

export const SSDP_MULTICAST_ADDRESS = '239.255.255.250';
export const SSDP_MULTICAST_PORT = 1900;
export const WAN_SERVICE_TYPES = [
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANIPConnection:2',
  'urn:schemas-upnp-org:service:WANPPPConnection:1',
];

export function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
}

export function discoverGateway({
  timeoutMs = 3000,
  searchTarget = 'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  ssdpHost = SSDP_MULTICAST_ADDRESS,
  ssdpPort = SSDP_MULTICAST_PORT,
} = {}) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const request = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
        `HOST: ${SSDP_MULTICAST_ADDRESS}:${SSDP_MULTICAST_PORT}\r\n` +
        'MAN: "ssdp:discover"\r\n' +
        'MX: 2\r\n' +
        `ST: ${searchTarget}\r\n` +
        '\r\n'
    );
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      fn(arg);
    };

    socket.on('message', (msg) => {
      const text = msg.toString('utf8');
      const match = /LOCATION:\s*(\S+)/i.exec(text);
      if (match) finish(resolve, { location: match[1].trim() });
    });

    socket.once('error', (e) => finish(reject, e));

    const timer = setTimeout(() => {
      finish(reject, new Error('UPnP gateway discovery timed out'));
    }, timeoutMs);

    socket.bind(0, () => {
      socket.send(request, ssdpPort, ssdpHost, (err) => {
        if (err) finish(reject, err);
      });
    });
  });
}

function httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => req.destroy(new Error(`GET ${url} timed out`)));
    req.on('error', reject);
  });
}

export function extractControlUrl(xml, location) {
  const serviceBlocks = xml.match(/<service>[\s\S]*?<\/service>/gi) || [];
  for (const block of serviceBlocks) {
    const typeMatch = /<serviceType>([^<]+)<\/serviceType>/i.exec(block);
    const controlMatch = /<controlURL>([^<]+)<\/controlURL>/i.exec(block);
    if (!typeMatch || !controlMatch) continue;
    const serviceType = typeMatch[1].trim();
    if (WAN_SERVICE_TYPES.includes(serviceType)) {
      return { serviceType, controlUrl: new URL(controlMatch[1].trim(), location).toString() };
    }
  }
  throw new Error('No WANIPConnection/WANPPPConnection service found in device description');
}

function soapEnvelope(serviceType, action, params) {
  const args = Object.entries(params)
    .map(([key, value]) => `<${key}>${value}</${key}>`)
    .join('');
  return (
    '<?xml version="1.0"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    '<s:Body>' +
    `<u:${action} xmlns:u="${serviceType}">${args}</u:${action}>` +
    '</s:Body>' +
    '</s:Envelope>'
  );
}

function soapRequest(controlUrl, serviceType, action, params = {}, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const body = soapEnvelope(serviceType, action, params);
    const url = new URL(controlUrl);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'Content-Length': Buffer.byteLength(body),
          SOAPAction: `"${serviceType}#${action}"`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`SOAP action ${action} failed with status ${res.statusCode}: ${data.slice(0, 300)}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`SOAP action ${action} timed out`)));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function extractTag(xml, tag) {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(xml);
  return match ? match[1] : null;
}

async function resolveGatewayService(timeoutMs, ssdpOverrides) {
  const { location } = await discoverGateway({ timeoutMs, ...ssdpOverrides });
  const xml = await httpGet(location, timeoutMs);
  return extractControlUrl(xml, location);
}

export async function openPortMapping({
  externalPort,
  internalPort = externalPort,
  internalClient = getLocalIPv4(),
  protocol = 'TCP',
  description = 'mesh',
  leaseDurationSec = 0,
  timeoutMs = 3000,
  ssdp,
} = {}) {
  const { serviceType, controlUrl } = await resolveGatewayService(timeoutMs, ssdp);

  await soapRequest(
    controlUrl,
    serviceType,
    'AddPortMapping',
    {
      NewRemoteHost: '',
      NewExternalPort: externalPort,
      NewProtocol: protocol,
      NewInternalPort: internalPort,
      NewInternalClient: internalClient,
      NewEnabled: 1,
      NewPortMappingDescription: description,
      NewLeaseDuration: leaseDurationSec,
    },
    timeoutMs
  );

  return { externalPort, internalPort, internalClient, protocol, controlUrl, serviceType };
}

export async function closePortMapping({ externalPort, protocol = 'TCP', controlUrl, serviceType, timeoutMs = 3000, ssdp } = {}) {
  const resolved = controlUrl && serviceType ? { controlUrl, serviceType } : await resolveGatewayService(timeoutMs, ssdp);

  await soapRequest(
    resolved.controlUrl,
    resolved.serviceType,
    'DeletePortMapping',
    { NewRemoteHost: '', NewExternalPort: externalPort, NewProtocol: protocol },
    timeoutMs
  );
}

export async function getExternalIpAddress({ controlUrl, serviceType, timeoutMs = 3000, ssdp } = {}) {
  const resolved = controlUrl && serviceType ? { controlUrl, serviceType } : await resolveGatewayService(timeoutMs, ssdp);
  const xml = await soapRequest(resolved.controlUrl, resolved.serviceType, 'GetExternalIPAddress', {}, timeoutMs);
  return extractTag(xml, 'NewExternalIPAddress');
}
