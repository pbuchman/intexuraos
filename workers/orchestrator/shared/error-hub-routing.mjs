export const HOME_DEV_ERROR_HUB_CONNECT_ADDRESS = 'fd00:172:28::1';

const TAILNET_DNS_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}ts\.net$/u;

export function validateErrorHubHost(value) {
  let origin;
  if (!/\s/u.test(value)) {
    try {
      origin = new URL(`https://${value}`);
    } catch {
      // Return a configuration error without including URL parser input.
    }
  }

  if (
    origin === undefined ||
    !TAILNET_DNS_HOSTNAME_PATTERN.test(origin.hostname) ||
    origin.port !== '8443' ||
    origin.host.toLowerCase() !== value.toLowerCase() ||
    origin.username !== '' ||
    origin.password !== '' ||
    origin.pathname !== '/' ||
    origin.search !== '' ||
    origin.hash !== ''
  ) {
    throw new TypeError(
      'Invalid INTEXURAOS_ERROR_HUB_HOST. Expected a tailnet DNS host on port 8443.'
    );
  }
  return origin.hostname;
}

export function validateErrorHubConnectAddress(address) {
  if (address !== undefined && address !== HOME_DEV_ERROR_HUB_CONNECT_ADDRESS) {
    throw new TypeError(
      'Invalid INTEXURAOS_ERROR_HUB_CONNECT_ADDRESS. Expected the Home Dev worker bridge gateway.'
    );
  }
  return address;
}

export function getErrorHubHostMapping(host, connectAddress) {
  const address = validateErrorHubConnectAddress(connectAddress);
  return address === undefined ? undefined : { hostname: validateErrorHubHost(host), address };
}
