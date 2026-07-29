import { describe, expect, it } from 'vitest';
import { assertWorkerNetworkInspection } from './worker-network-contract.js';

function validInspection(): Record<string, unknown> {
  return {
    Name: 'code-worker-net',
    Driver: 'bridge',
    EnableIPv6: true,
    Internal: false,
    IPAM: {
      Driver: 'default',
      Config: [{ Subnet: '172.28.0.0/16' }, { Subnet: 'fd00:172:28::/64' }],
    },
    Options: {
      'com.docker.network.bridge.enable_ip_masquerade': 'true',
      'com.docker.network.bridge.name': 'code-worker-br',
    },
  };
}

describe('assertWorkerNetworkInspection', () => {
  it.each([
    {},
    {
      'com.docker.network.bridge.gateway_mode_ipv4': 'nat',
      'com.docker.network.bridge.gateway_mode_ipv6': 'nat',
    },
  ])('accepts the exact contract with absent-or-nat gateway modes', (gatewayModes) => {
    const inspection = validInspection();
    inspection['Options'] = { ...(inspection['Options'] as object), ...gatewayModes };

    expect(() => assertWorkerNetworkInspection(inspection)).not.toThrow();
  });

  it.each([
    ['network name', { Name: 'custom-worker-net' }, 'name must be code-worker-net'],
    ['network driver', { Driver: 'overlay' }, 'driver must be bridge'],
    ['IPv6 disabled', { EnableIPv6: false }, 'IPv6 must be enabled'],
    ['internal network', { Internal: true }, 'network must not be internal'],
    [
      'non-default IPAM',
      { IPAM: { Driver: 'custom-ipam', Config: validInspectionIpamConfig() } },
      'IPAM driver must be default',
    ],
    [
      'wrong IPv4 subnet',
      {
        IPAM: {
          Driver: 'default',
          Config: [{ Subnet: '192.0.2.0/24' }, { Subnet: 'fd00:172:28::/64' }],
        },
      },
      'IPAM subnets must be exactly',
    ],
    [
      'wrong IPv6 subnet',
      {
        IPAM: {
          Driver: 'default',
          Config: [{ Subnet: '172.28.0.0/16' }, { Subnet: 'fd00:172:29::/64' }],
        },
      },
      'IPAM subnets must be exactly',
    ],
    [
      'additional subnet',
      {
        IPAM: {
          Driver: 'default',
          Config: [
            { Subnet: '172.28.0.0/16' },
            { Subnet: 'fd00:172:28::/64' },
            { Subnet: '198.51.100.0/24' },
          ],
        },
      },
      'IPAM subnets must be exactly',
    ],
    [
      'wrong bridge name',
      {
        Options: {
          'com.docker.network.bridge.enable_ip_masquerade': 'true',
          'com.docker.network.bridge.name': 'br-deadbeef',
        },
      },
      'Linux bridge name must be code-worker-br',
    ],
    [
      'masquerade disabled',
      {
        Options: {
          'com.docker.network.bridge.enable_ip_masquerade': 'false',
          'com.docker.network.bridge.name': 'code-worker-br',
        },
      },
      'IP masquerade must be enabled',
    ],
    [
      'IPv4 routed gateway',
      {
        Options: {
          'com.docker.network.bridge.enable_ip_masquerade': 'true',
          'com.docker.network.bridge.gateway_mode_ipv4': 'routed',
          'com.docker.network.bridge.name': 'code-worker-br',
        },
      },
      'IPv4 gateway mode must be nat',
    ],
    [
      'IPv6 routed gateway',
      {
        Options: {
          'com.docker.network.bridge.enable_ip_masquerade': 'true',
          'com.docker.network.bridge.gateway_mode_ipv6': 'routed',
          'com.docker.network.bridge.name': 'code-worker-br',
        },
      },
      'IPv6 gateway mode must be nat',
    ],
  ] as const)('rejects incompatible %s', (_name, override, expectedError) => {
    const inspection = { ...validInspection(), ...override };

    expect(() => assertWorkerNetworkInspection(inspection)).toThrow(expectedError);
  });

  it('rejects malformed Docker inspection output with an actionable error', () => {
    expect(() => assertWorkerNetworkInspection({ Driver: 'bridge' })).toThrow(
      'Docker network inspection is missing IPAM.Config'
    );
  });
});

function validInspectionIpamConfig(): readonly Record<string, string>[] {
  return [{ Subnet: '172.28.0.0/16' }, { Subnet: 'fd00:172:28::/64' }];
}
