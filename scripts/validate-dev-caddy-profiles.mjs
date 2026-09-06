#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDirectory, '..');
const generatorPath = resolve(moduleDirectory, 'generate-dev-caddy.mjs');
const fixtureDirectory = resolve(repoRoot, 'config', 'edge', 'generated');
const dockerBin = process.env.DEV_EDGE_DOCKER_BIN ?? 'docker';
const CADDY_IMAGE =
  'docker.io/library/caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d';
const FIXTURES = [
  { args: ['--profile', 'active-pre-cutover'], name: 'active-pre-cutover.caddy' },
  { args: ['--profile', 'active-post-cutover'], name: 'active-post-cutover.caddy' },
  { args: ['--profile', 'draining'], name: 'draining.caddy' },
  { args: ['--profile', 'hibernated'], name: 'hibernated.caddy' },
  { args: ['--matrix-fragment'], name: 'matrix-outbound.caddy' },
];

function commandFailure(label, result) {
  if (result.error !== undefined) {
    return new Error(`${label}: ${result.error.message}`);
  }
  const details = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim().slice(0, 2000);
  return new Error(
    `${label} exited ${String(result.status)}${details === '' ? '' : `: ${details}`}`
  );
}

function runDocker(args, label) {
  const result = spawnSync(dockerBin, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw commandFailure(label, result);
  }
}

function assertFixtureMatchesGenerator(fixture) {
  const fixturePath = resolve(fixtureDirectory, fixture.name);
  const tracked = readFileSync(fixturePath);
  const generated = execFileSync(process.execPath, [generatorPath, ...fixture.args], {
    cwd: repoRoot,
  });
  if (!tracked.equals(generated)) {
    throw new Error(`${fixture.name} does not match deterministic generator output`);
  }
  return {
    bytes: tracked,
    fixturePath,
    sha256: createHash('sha256').update(tracked).digest('hex'),
  };
}

function validateFixture(fixture, validationRoot) {
  const { bytes, fixturePath, sha256 } = assertFixtureMatchesGenerator(fixture);
  const isolatedDirectory = resolve(validationRoot, fixture.name.replace(/\.caddy$/u, ''));
  const isolatedConfig = resolve(isolatedDirectory, 'Caddyfile');
  mkdirSync(isolatedDirectory, { recursive: true });
  copyFileSync(fixturePath, isolatedConfig);
  if (!readFileSync(isolatedConfig).equals(bytes)) {
    throw new Error(`${fixture.name} isolated validation copy does not match source bytes`);
  }

  runDocker(
    [
      'run',
      '--rm',
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      '--cap-add=NET_BIND_SERVICE',
      '--security-opt=no-new-privileges',
      '--pull=never',
      `--volume=${isolatedConfig}:/validation/Caddyfile:ro`,
      '--tmpfs=/var/log/caddy:rw,noexec,nosuid,nodev,size=16m,mode=1777',
      '--tmpfs=/config:rw,noexec,nosuid,nodev,size=16m',
      '--tmpfs=/data:rw,noexec,nosuid,nodev,size=16m',
      '--workdir=/validation',
      CADDY_IMAGE,
      'caddy',
      'validate',
      '--config',
      '/validation/Caddyfile',
      '--adapter',
      'caddyfile',
    ],
    `Caddy validation for ${fixture.name}`
  );
  return { name: fixture.name, sha256, status: 'PASS' };
}

let validationRoot;
try {
  runDocker(['pull', CADDY_IMAGE], 'Pinned Caddy image pull');
  validationRoot = mkdtempSync(join(tmpdir(), 'intexuraos-dev-edge-caddy-'));
  const fixtures = FIXTURES.map((fixture) => validateFixture(fixture, validationRoot));
  process.stdout.write(
    `${JSON.stringify({ caddyImage: CADDY_IMAGE, fixtures, status: 'PASS' })}\n`
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Caddy validation failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  if (validationRoot !== undefined) {
    rmSync(validationRoot, { recursive: true, force: true });
  }
}
