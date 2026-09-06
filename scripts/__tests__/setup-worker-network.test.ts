import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const setupScript = resolve(repoRoot, 'scripts/setup-worker-network.sh');
const temporaryDirectories: string[] = [];

const _networkStates = [
  'missing',
  'valid',
  'nat-gateway-modes',
  'wrong-driver',
  'nondefault-ipam',
  'internal',
  'ipv6-disabled',
  'bridge-name-mismatch',
  'bridge-name-missing',
  'masquerade-disabled',
  'masquerade-missing',
  'ipv4-subnet-mismatch',
  'ipv6-subnet-mismatch',
  'extra-subnet',
  'ipv4-gateway-routed',
  'ipv6-gateway-routed',
] as const;

type NetworkState = (typeof _networkStates)[number];

interface RunResult {
  readonly createArgs: readonly string[];
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function runSetup(
  networkState: NetworkState,
  overrides: Readonly<Record<string, string>> = {}
): RunResult {
  const directory = mkdtempSync(join(tmpdir(), 'setup-worker-network-'));
  temporaryDirectories.push(directory);
  const dockerPath = join(directory, 'docker');
  const createArgsPath = join(directory, 'create-args');
  const createdPath = join(directory, 'created');

  writeFileSync(
    dockerPath,
    `#!/bin/bash
set -euo pipefail

if [[ "$1" == "network" && "$2" == "create" ]]; then
  printf '%s\\n' "$@" > "$FAKE_DOCKER_CREATE_ARGS"
  touch "$FAKE_DOCKER_CREATED"
  exit 0
fi

if [[ "$1" != "network" || "$2" != "inspect" ]]; then
  exit 64
fi

if [[ "$FAKE_NETWORK_STATE" == "missing" && ! -f "$FAKE_DOCKER_CREATED" ]]; then
  exit 1
fi

state="$FAKE_NETWORK_STATE"
if [[ -f "$FAKE_DOCKER_CREATED" ]]; then
  state="valid"
fi

format=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "--format" ]]; then
    format="$argument"
    break
  fi
  previous="$argument"
done

case "$format" in
  '') ;;
  '{{.Driver}}')
    [[ "$state" == "wrong-driver" ]] && printf 'overlay\\n' || printf 'bridge\\n'
    ;;
  '{{.IPAM.Driver}}')
    [[ "$state" == "nondefault-ipam" ]] && printf 'custom-ipam\\n' || printf 'default\\n'
    ;;
  '{{.Internal}}')
    [[ "$state" == "internal" ]] && printf 'true\\n' || printf 'false\\n'
    ;;
  '{{.EnableIPv6}}')
    [[ "$state" == "ipv6-disabled" ]] && printf 'false\\n' || printf 'true\\n'
    ;;
  '{{index .Options "com.docker.network.bridge.enable_ip_masquerade"}}')
    if [[ "$state" == "masquerade-disabled" ]]; then
      printf 'false\\n'
    elif [[ "$state" == "masquerade-missing" ]]; then
      printf '\\n'
    else
      printf 'true\\n'
    fi
    ;;
  '{{index .Options "com.docker.network.bridge.name"}}')
    if [[ "$state" == "bridge-name-mismatch" ]]; then
      printf 'br-deadbeef\\n'
    elif [[ "$state" == "bridge-name-missing" ]]; then
      printf '\\n'
    else
      printf 'code-worker-br\\n'
    fi
    ;;
  '{{index .Options "com.docker.network.bridge.gateway_mode_ipv4"}}')
    if [[ "$state" == "ipv4-gateway-routed" ]]; then
      printf 'routed\\n'
    elif [[ "$state" == "nat-gateway-modes" ]]; then
      printf 'nat\\n'
    else
      printf '\\n'
    fi
    ;;
  '{{index .Options "com.docker.network.bridge.gateway_mode_ipv6"}}')
    if [[ "$state" == "ipv6-gateway-routed" ]]; then
      printf 'routed\\n'
    elif [[ "$state" == "nat-gateway-modes" ]]; then
      printf 'nat\\n'
    else
      printf '\\n'
    fi
    ;;
  '{{range .IPAM.Config}}{{println .Subnet}}{{end}}')
    if [[ "$state" == "ipv4-subnet-mismatch" ]]; then
      printf '192.0.2.0/24\\n'
    else
      printf '172.28.0.0/16\\n'
    fi
    if [[ "$state" == "ipv6-subnet-mismatch" ]]; then
      printf 'fd00:172:29::/64\\n'
    else
      printf 'fd00:172:28::/64\\n'
    fi
    if [[ "$state" == "extra-subnet" ]]; then
      printf '198.51.100.0/24\\n'
    fi
    ;;
  '{{.Name}}: {{range .IPAM.Config}}{{.Subnet}} {{end}}')
    printf 'code-worker-net: 172.28.0.0/16 fd00:172:28::/64 \\n'
    ;;
  *) exit 65 ;;
esac
`,
    'utf8'
  );
  chmodSync(dockerPath, 0o755);

  const result = spawnSync('bash', [setupScript], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      BRIDGE_NAME: 'code-worker-br',
      FAKE_DOCKER_CREATE_ARGS: createArgsPath,
      FAKE_DOCKER_CREATED: createdPath,
      FAKE_NETWORK_STATE: networkState,
      IPV6_SUBNET: 'fd00:172:28::/64',
      NETWORK_NAME: 'code-worker-net',
      PATH: `${directory}:${process.env['PATH'] ?? ''}`,
      SUBNET: '172.28.0.0/16',
      ...overrides,
    },
  });

  return {
    createArgs: existsSync(createArgsPath)
      ? readFileSync(createArgsPath, 'utf8').trim().split('\n')
      : [],
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('setup-worker-network.sh', () => {
  it('creates the exact worker network contract with argument boundaries preserved', () => {
    const result = runSetup('missing');

    expect(result.status).toBe(0);
    expect(result.createArgs).toEqual([
      'network',
      'create',
      '--driver',
      'bridge',
      '--ipv6',
      '--opt',
      'com.docker.network.bridge.name=code-worker-br',
      '--opt',
      'com.docker.network.bridge.enable_ip_masquerade=true',
      '--subnet',
      '172.28.0.0/16',
      '--subnet',
      'fd00:172:28::/64',
      'code-worker-net',
    ]);
  });

  it('ignores ambient overrides and still creates the exact worker network contract', () => {
    const result = runSetup('missing', {
      BRIDGE_NAME: 'é'.repeat(15),
      IPV6_SUBNET: 'fd00:ffff::/64',
      NETWORK_NAME: 'custom-worker-net',
      SUBNET: '192.0.2.0/24',
    });

    expect(result.status).toBe(0);
    expect(result.createArgs.at(-1)).toBe('code-worker-net');
    expect(result.createArgs).toContain('com.docker.network.bridge.name=code-worker-br');
    expect(result.createArgs).toContain('172.28.0.0/16');
    expect(result.createArgs).toContain('fd00:172:28::/64');
  });

  it.each(['valid', 'nat-gateway-modes'] as const)(
    'accepts an existing network that satisfies the exact contract: %s',
    (networkState) => {
      const result = runSetup(networkState);

      expect(result.status).toBe(0);
      expect(result.createArgs).toEqual([]);
      expect(result.stdout).toContain("Network 'code-worker-net' already exists");
    }
  );

  it.each([
    ['wrong-driver', 'driver must be bridge'],
    ['nondefault-ipam', 'IPAM driver must be default'],
    ['internal', 'network must not be internal'],
    ['ipv6-disabled', 'IPv6 must be enabled'],
    ['bridge-name-mismatch', 'Linux bridge name must be code-worker-br'],
    ['bridge-name-missing', 'Linux bridge name must be code-worker-br'],
    ['masquerade-disabled', 'IP masquerade must be enabled'],
    ['masquerade-missing', 'IP masquerade must be enabled'],
    ['ipv4-subnet-mismatch', 'IPAM subnets must be exactly'],
    ['ipv6-subnet-mismatch', 'IPAM subnets must be exactly'],
    ['extra-subnet', 'IPAM subnets must be exactly'],
    ['ipv4-gateway-routed', 'IPv4 gateway mode must be nat'],
    ['ipv6-gateway-routed', 'IPv6 gateway mode must be nat'],
  ] as const)(
    'fails closed without recreating an incompatible existing network: %s',
    (networkState, expectedError) => {
      const result = runSetup(networkState);

      expect(result.status).not.toBe(0);
      expect(result.createArgs).toEqual([]);
      expect(result.stderr).toContain(expectedError);
      expect(result.stderr).toContain('Refusing to modify or replace');
    }
  );
});
