import { execFileSync } from 'node:child_process';

export const WORKER_NETWORK_NAME = 'code-worker-net';

const WORKER_BRIDGE_NAME = 'code-worker-br';
const WORKER_IPV4_SUBNET = '172.28.0.0/16';
const WORKER_IPV6_SUBNET = 'fd00:172:28::/64';

const BRIDGE_NAME_OPTION = 'com.docker.network.bridge.name';
const MASQUERADE_OPTION = 'com.docker.network.bridge.enable_ip_masquerade';
const IPV4_GATEWAY_MODE_OPTION = 'com.docker.network.bridge.gateway_mode_ipv4';
const IPV6_GATEWAY_MODE_OPTION = 'com.docker.network.bridge.gateway_mode_ipv6';

type UnknownRecord = Record<string, unknown>;

export function assertWorkerNetworkInspection(value: unknown): void {
  const inspection = requiredRecord(value, 'Docker network inspection');
  const ipam = optionalRecord(inspection['IPAM']);
  const config = inspectionArray(ipam['Config']);
  const options = optionalRecord(inspection['Options']);
  const errors: string[] = [];

  if (inspection['Name'] !== WORKER_NETWORK_NAME) {
    errors.push(`name must be ${WORKER_NETWORK_NAME}`);
  }
  if (inspection['Driver'] !== 'bridge') {
    errors.push('driver must be bridge');
  }
  if (ipam['Driver'] !== 'default') {
    errors.push('IPAM driver must be default');
  }
  if (inspection['Internal'] !== false) {
    errors.push('network must not be internal');
  }
  if (inspection['EnableIPv6'] !== true) {
    errors.push('IPv6 must be enabled');
  }
  if (options[BRIDGE_NAME_OPTION] !== WORKER_BRIDGE_NAME) {
    errors.push(`Linux bridge name must be ${WORKER_BRIDGE_NAME}`);
  }
  if (options[MASQUERADE_OPTION] !== 'true') {
    errors.push('IP masquerade must be enabled');
  }
  if (!isNatOrAbsent(options[IPV4_GATEWAY_MODE_OPTION])) {
    errors.push('IPv4 gateway mode must be nat when configured');
  }
  if (!isNatOrAbsent(options[IPV6_GATEWAY_MODE_OPTION])) {
    errors.push('IPv6 gateway mode must be nat when configured');
  }

  const subnets = config
    .map((entry) => optionalRecord(entry)['Subnet'])
    .filter((subnet): subnet is string => typeof subnet === 'string');
  if (
    subnets.length !== 2 ||
    !subnets.includes(WORKER_IPV4_SUBNET) ||
    !subnets.includes(WORKER_IPV6_SUBNET)
  ) {
    errors.push(`IPAM subnets must be exactly ${WORKER_IPV4_SUBNET} and ${WORKER_IPV6_SUBNET}`);
  }

  if (errors.length > 0) {
    throw new Error(
      `Worker network '${WORKER_NETWORK_NAME}' does not satisfy the required dual-stack contract:\n${errors.map((error) => `  - ${error}`).join('\n')}\nRun ./scripts/setup-worker-network.sh.`
    );
  }
}

export function assertWorkerNetworkContract(): void {
  let inspection: unknown;
  try {
    const output = execFileSync(
      'docker',
      ['network', 'inspect', WORKER_NETWORK_NAME, '--format', '{{json .}}'],
      { encoding: 'utf8' }
    );
    inspection = JSON.parse(output);
  } catch {
    throw new Error(
      `Unable to inspect worker network '${WORKER_NETWORK_NAME}'; run ./scripts/setup-worker-network.sh`
    );
  }

  assertWorkerNetworkInspection(inspection);
}

function inspectionArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('Docker network inspection is missing IPAM.Config');
  }
  return value;
}

function requiredRecord(value: unknown, name: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as UnknownRecord;
}

function optionalRecord(value: unknown): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value as UnknownRecord;
}

function isNatOrAbsent(value: unknown): boolean {
  return value === undefined || value === 'nat';
}
