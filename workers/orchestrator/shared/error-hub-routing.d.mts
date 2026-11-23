export const HOME_DEV_ERROR_HUB_CONNECT_ADDRESS: 'fd00:172:28::1';
export function validateErrorHubHost(value: string): string;
export function validateErrorHubConnectAddress(
  address: string | undefined
): 'fd00:172:28::1' | undefined;
export function getErrorHubHostMapping(
  host: string,
  connectAddress: string | undefined
): { hostname: string; address: 'fd00:172:28::1' } | undefined;
