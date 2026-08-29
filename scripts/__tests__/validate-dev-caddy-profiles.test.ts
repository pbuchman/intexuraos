import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const validatorPath = resolve(repoRoot, 'scripts', 'validate-dev-caddy-profiles.mjs');
const CADDY_IMAGE =
  'docker.io/library/caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d';
const temporaryDirectories: string[] = [];

function makeFakeDocker(): { executable: string; log: string } {
  const directory = mkdtempSync(join(tmpdir(), 'dev-edge-fake-docker-'));
  temporaryDirectories.push(directory);
  const executable = join(directory, 'docker');
  const log = join(directory, 'calls.jsonl');
  writeFileSync(
    executable,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + '\\n');
if (args[0] === process.env.FAKE_DOCKER_FAIL_COMMAND) process.exit(41);
`
  );
  chmodSync(executable, 0o700);
  return { executable, log };
}

function runValidator(
  dockerExecutable: string,
  log: string,
  failCommand?: string
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [validatorPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEV_EDGE_DOCKER_BIN: dockerExecutable,
      FAKE_DOCKER_FAIL_COMMAND: failCommand,
      FAKE_DOCKER_LOG: log,
    },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('DEV Caddy profile validator', () => {
  it('wires the fail-closed validator into the tracked CI gate', () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const ciSource = readFileSync(resolve(repoRoot, 'scripts', 'ci.mjs'), 'utf8');
    const workflowSource = readFileSync(
      resolve(repoRoot, '.github', 'workflows', 'ci.yml'),
      'utf8'
    );

    expect(packageJson.scripts['verify:dev-edge-profiles']).toBe(
      'node scripts/validate-dev-caddy-profiles.mjs'
    );
    expect(ciSource).toContain(
      "{ name: 'dev-edge-profiles', script: 'validate-dev-caddy-profiles.mjs' }"
    );
    expect(workflowSource).toContain(
      '- name: Validate DEV Edge Profiles\n        run: node scripts/validate-dev-caddy-profiles.mjs'
    );
  });

  it('pins the official multi-platform Caddy image and validates all five fixtures', () => {
    const fake = makeFakeDocker();
    const result = runValidator(fake.executable, fake.log);

    expect(result.status).toBe(0);
    const summary = JSON.parse(result.stdout) as {
      caddyImage: string;
      fixtures: { name: string; sha256: string; status: string }[];
      status: string;
    };
    expect(summary.status).toBe('PASS');
    expect(summary.caddyImage).toBe(CADDY_IMAGE);
    expect(summary.fixtures.map(({ name, status }) => [name, status])).toEqual([
      ['active-pre-cutover.caddy', 'PASS'],
      ['active-post-cutover.caddy', 'PASS'],
      ['draining.caddy', 'PASS'],
      ['hibernated.caddy', 'PASS'],
      ['matrix-outbound.caddy', 'PASS'],
    ]);
    expect(summary.fixtures.every(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256))).toBe(true);

    const calls = readFileSync(fake.log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
    expect(calls[0]).toEqual(['pull', CADDY_IMAGE]);
    expect(calls.slice(1)).toHaveLength(5);
    for (const call of calls.slice(1)) {
      expect(call[0]).toBe('run');
      expect(call).toContain('--network=none');
      expect(call).toContain('--read-only');
      expect(call).toContain('--cap-drop=ALL');
      expect(call).toContain('--cap-add=NET_BIND_SERVICE');
      expect(call).toContain('--security-opt=no-new-privileges');
      expect(call).toContain('--pull=never');
      expect(call).toContain(CADDY_IMAGE);
      expect(call.slice(-6)).toEqual([
        'caddy',
        'validate',
        '--config',
        '/validation/Caddyfile',
        '--adapter',
        'caddyfile',
      ]);
    }
  });

  it('fails closed when Docker is unavailable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dev-edge-missing-docker-'));
    temporaryDirectories.push(directory);
    const result = runValidator(join(directory, 'missing-docker'), join(directory, 'calls.jsonl'));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Caddy validation failed');
  });

  it('fails closed when any real Caddy validation invocation fails', () => {
    const fake = makeFakeDocker();
    const result = runValidator(fake.executable, fake.log, 'run');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Caddy validation failed');
    const calls = readFileSync(fake.log, 'utf8').trim().split('\n');
    expect(calls).toHaveLength(2);
  });
});
