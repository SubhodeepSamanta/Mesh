import { getLocalIPv4, discoverReflexiveAddress, openPortMapping, closePortMapping, getExternalIpAddress } from '@mesh/engine';

export async function diagnoseCommand({ log = console.log } = {}) {
  const localIp = getLocalIPv4();
  log(`Local interface address: ${localIp}`);

  let stunResult = null;
  try {
    stunResult = await discoverReflexiveAddress();
    log(`STUN reflexive address: ${stunResult.address}:${stunResult.port}`);
  } catch (e) {
    log(`STUN discovery failed: ${e.message}`);
  }

  let upnpResult = null;
  const probePort = 51000 + Math.floor(Math.random() * 1000);
  try {
    upnpResult = await openPortMapping({
      externalPort: probePort,
      internalPort: probePort,
      protocol: 'TCP',
      description: 'mesh-diagnose',
    });
    const externalIp = await getExternalIpAddress({ controlUrl: upnpResult.controlUrl, serviceType: upnpResult.serviceType });
    log(`UPnP gateway found. Router-reported external IP: ${externalIp}`);
    log(`Successfully mapped external port ${probePort} -> internal port ${probePort}`);
    await closePortMapping({
      externalPort: probePort,
      protocol: 'TCP',
      controlUrl: upnpResult.controlUrl,
      serviceType: upnpResult.serviceType,
    });
  } catch (e) {
    log(`UPnP not available: ${e.message}`);
  }

  const tier = upnpResult
    ? 'direct (UPnP-assisted)'
    : stunResult
      ? 'best-effort direct — a manual port-forward may be needed for inbound connections'
      : 'relay-only — configure --turn-host/--turn-secret when sending';

  log(`\nLikely connectivity tier for incoming transfers: ${tier}`);

  return { localIp, stun: stunResult, upnpAvailable: Boolean(upnpResult) };
}
