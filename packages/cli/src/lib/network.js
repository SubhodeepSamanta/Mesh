import { getLocalIPv4, openPortMapping, getExternalIpAddress, discoverReflexiveAddress } from '@mesh/engine';

export async function resolvePublicEndpoint({ localPort, protocol = 'TCP', description = 'mesh', explicitHost = null, skipUpnp = false, skipStun = false }) {
  if (explicitHost) {
    return { host: explicitHost, port: localPort, method: 'manual' };
  }

  if (!skipUpnp) {
    try {
      const mapping = await openPortMapping({ externalPort: localPort, internalPort: localPort, protocol, description });
      const externalIp = await getExternalIpAddress({ controlUrl: mapping.controlUrl, serviceType: mapping.serviceType });
      if (externalIp) {
        return { host: externalIp, port: localPort, method: 'upnp' };
      }
    } catch {}
  }

  if (!skipStun) {
    try {
      const reflexive = await discoverReflexiveAddress();
      return { host: reflexive.address, port: localPort, method: 'stun', observedPort: reflexive.port };
    } catch {}
  }

  return { host: getLocalIPv4(), port: localPort, method: 'local' };
}
