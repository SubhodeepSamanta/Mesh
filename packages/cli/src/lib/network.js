import { getLocalIPv4, openPortMapping, getExternalIpAddress, discoverReflexiveAddress, DEFAULT_STUN_SERVERS } from '@mesh/engine';

export async function resolvePublicEndpoint({ localPort, protocol = 'TCP', description = 'mesh', explicitHost = null, skipUpnp = false, skipStun = false, stunSocket = null }) {
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
      // When the service's own socket is provided, the reflexive mapping (IP
      // and port) belongs to that socket, so the observed port is the real
      // public port. Otherwise the port is only a same-port guess.
      const reflexive = await discoverReflexiveAddress(DEFAULT_STUN_SERVERS, stunSocket ? { socket: stunSocket } : {});
      return {
        host: reflexive.address,
        port: stunSocket ? reflexive.port : localPort,
        method: 'stun',
        observedPort: reflexive.port,
      };
    } catch {}
  }

  return { host: getLocalIPv4(), port: localPort, method: 'local' };
}

export async function resolveCandidates({ localPort, protocol = 'TCP', description = 'mesh', explicitHost = null, skipUpnp = false, skipStun = false, stunSocket = null }) {
  const localHost = getLocalIPv4();
  const endpoint = await resolvePublicEndpoint({ localPort, protocol, description, explicitHost, skipUpnp, skipStun, stunSocket });

  const candidates = [{ addr: localHost, port: localPort }];
  if (endpoint.host !== localHost) {
    candidates.push({ addr: endpoint.host, port: endpoint.port });
  }

  return { candidates, method: endpoint.method, primaryHost: endpoint.host };
}

// Builds the resolveTransferCandidates callback used when seeding: resolves
// the TCP chunk-server port (UPnP or local) and always includes the already
// known public host, so a manual port-forward is advertised even without UPnP.
export function makeTransferCandidateResolver({ explicitHost = null, skipUpnp = false, publicHost = null }) {
  return async (transferPort) => {
    const resolved = await resolveCandidates({
      localPort: transferPort,
      protocol: 'TCP',
      description: 'mesh-transfer',
      explicitHost,
      skipUpnp,
      skipStun: true,
    }).catch(() => ({ candidates: [] }));

    const candidates = resolved.candidates;
    if (publicHost && !candidates.some((c) => c.addr === publicHost)) {
      candidates.push({ addr: publicHost, port: transferPort });
    }
    if (candidates.length === 0) {
      candidates.push({ addr: getLocalIPv4(), port: transferPort });
    }
    return candidates;
  };
}
