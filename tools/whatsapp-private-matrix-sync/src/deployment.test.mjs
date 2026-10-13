import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tool = fileURLToPath(new URL('../', import.meta.url));
const deploy = path.join(tool, 'deploy/home-dev');
const sha = '1234567890abcdef1234567890abcdef12345678';

async function fixture(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'matrix-deploy-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  await fsp.mkdir(bin);
  await fsp.writeFile(
    path.join(bin, 'git'),
    `#!/bin/sh\ncase "$*" in *rev-parse*) echo ${sha} ;; *status*) printf '%s' "\${FIXTURE_DIRTY_SOURCE:-}" ;; esac\n`,
    { mode: 0o755 }
  );
  const log = path.join(directory, 'docker-calls');
  await fsp.writeFile(path.join(bin, 'docker'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`, {
    mode: 0o755,
  });
  const state = path.join(directory, 'legacy-state');
  const secrets = path.join(directory, 'legacy-secrets');
  await fsp.mkdir(state);
  await fsp.mkdir(secrets);
  await fsp.writeFile(
    path.join(state, 'state.json'),
    '{"nextBatch":"s0","updatedAt":"2026-09-16T14:01:09.437Z"}\n'
  );
  await fsp.writeFile(path.join(state, 'pending-media.json'), '{"version":1,"items":[]}\n');
  await fsp.writeFile(path.join(secrets, 'matrix-access-token'), 'fixture-token', { mode: 0o600 });
  await fsp.writeFile(path.join(secrets, 'matrix-outbound-auth-token'), 'fixture-bearer', {
    mode: 0o600,
  });
  await fsp.writeFile(path.join(secrets, 'private-sync-service-account.json'), '{}', {
    mode: 0o600,
  });
  const targets = path.join(directory, 'matrix-outbound-targets.json');
  await fsp.writeFile(targets, '{}', { mode: 0o600 });
  const ca = path.join(directory, 'active-caddy-root.crt');
  await fsp.writeFile(
    ca,
    '-----BEGIN CERTIFICATE-----\nfixture-public-ca\n-----END CERTIFICATE-----\n'
  );
  const env = path.join(directory, 'integration.env');
  await fsp.writeFile(
    env,
    'MATRIX_HOMESERVER_URL=https://home-dev\nINTEXURAOS_SOURCE_ACCOUNT_ID=fixture-account\n',
    { mode: 0o600 }
  );
  const target = path.join(directory, 'prepared');
  const args = [
    '--prepare-only',
    '--source-sha',
    sha,
    '--deploy-dir',
    target,
    '--env-file',
    env,
    '--state-dir',
    state,
    '--secrets-dir',
    secrets,
    '--targets-file',
    targets,
    '--ca-file',
    ca,
  ];
  const invoke = (extra = [], envOverrides = {}) =>
    spawnSync('bash', [path.join(deploy, 'install.sh'), ...args, ...extra], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...envOverrides },
    });
  return { directory, log, state, secrets, targets, ca, env, target, invoke };
}

test('canonical image uses frozen dependencies, pinned Node, exact revision and authenticated health', () => {
  const dockerfile = fs.readFileSync(path.join(tool, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /FROM node:22\.23\.3-alpine@sha256:[a-f0-9]{64}/);
  assert.match(dockerfile, /COPY package\.json package-lock\.json/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision/);
  assert.match(dockerfile, /HEALTHCHECK --interval=30s .*--start-period=120s/);
  assert.match(dockerfile, /healthcheck\.mjs/);
  const manifest = JSON.parse(fs.readFileSync(path.join(tool, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(tool, 'package-lock.json')));
  assert.equal(manifest.dependencies['google-auth-library'], '10.9.1');
  assert.equal(lock.packages[''].dependencies['google-auth-library'], '10.9.1');
  assert.equal(lock.packages['node_modules/google-auth-library'].version, '10.9.1');
});

test('prepare-only installation preserves protected data and never invokes lifecycle commands', async (t) => {
  const f = await fixture(t);
  const before = await fsp.readFile(path.join(f.state, 'state.json'));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = f.invoke();
    assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual(await fsp.readFile(path.join(f.state, 'state.json')), before);
  assert.equal(
    await fsp.readFile(path.join(f.secrets, 'matrix-access-token'), 'utf8'),
    'fixture-token'
  );
  assert.equal(fs.existsSync(path.join(f.state, 'recovery-required')), false);
  assert.equal((await fsp.stat(path.join(f.target, '.env'))).mode & 0o777, 0o600);
  const calls = await fsp.readFile(f.log, 'utf8');
  assert.match(calls, /--project-name intexuraos-matrix-sync/);
  assert.doesNotMatch(calls, /\b(up|down|stop|start|restart|run|build|rm)\b/);
  const preparedEnv = await fsp.readFile(path.join(f.target, '.env'), 'utf8');
  assert.match(preparedEnv, new RegExp(`MATRIX_SYNC_STATE_DIR=${f.state}`));
  assert.match(preparedEnv, new RegExp(`MATRIX_SYNC_SECRETS_DIR=${f.secrets}`));
  assert.match(preparedEnv, new RegExp(`MATRIX_SYNC_CA_FILE=${f.ca}`));
});

test('installer rejects unknown revision, TLS bypass and changed existing environment', async (t) => {
  const f = await fixture(t);
  assert.notEqual(f.invoke(['--source-sha', '0'.repeat(40)]).status, 0);
  assert.notEqual(f.invoke([], { FIXTURE_DIRTY_SOURCE: ' M src/server.mjs' }).status, 0);
  await fsp.appendFile(f.env, 'NODE_TLS_REJECT_UNAUTHORIZED=0\n');
  assert.notEqual(f.invoke().status, 0);
  await fsp.writeFile(f.env, 'MATRIX_HOMESERVER_URL=https://home-dev\n');
  assert.equal(f.invoke().status, 0);
  await fsp.appendFile(f.env, 'INTEXURAOS_SOURCE_ACCOUNT_ID=other-account\n');
  assert.notEqual(f.invoke().status, 0);
  assert.doesNotMatch(await fsp.readFile(path.join(f.target, '.env'), 'utf8'), /other-account/);
});

test('installer rejects Compose-supported TLS override forms before writing prepared files', async (t) => {
  const f = await fixture(t);
  for (const assignment of [
    'NODE_TLS_REJECT_UNAUTHORIZED=0',
    'export NODE_TLS_REJECT_UNAUTHORIZED=0',
    'NODE_TLS_REJECT_UNAUTHORIZED: 0',
    'NODE_TLS_REJECT_UNAUTHORIZED = "0"',
  ]) {
    await fsp.writeFile(f.env, `MATRIX_HOMESERVER_URL=https://home-dev\n${assignment}\n`);
    const result = f.invoke();
    assert.notEqual(result.status, 0, assignment);
    assert.equal(fs.existsSync(path.join(f.target, '.env')), false);
    assert.equal(JSON.parse(result.stderr).error, 'tls_bypass_forbidden');
  }
});

test('effective Compose runtime enables TLS verification even if a prepared env is edited', async (t) => {
  const f = await fixture(t);
  assert.equal(f.invoke().status, 0);
  const preparedEnv = await fsp.readFile(path.join(f.target, '.env'), 'utf8');
  for (const assignment of [
    'export NODE_TLS_REJECT_UNAUTHORIZED=0',
    'NODE_TLS_REJECT_UNAUTHORIZED: 0',
  ]) {
    await fsp.writeFile(path.join(f.target, '.env'), `${preparedEnv}${assignment}\n`);
    const rendered = JSON.parse(
      execFileSync(
        'docker',
        [
          'compose',
          '--project-name',
          'intexuraos-matrix-sync',
          '--env-file',
          path.join(f.target, '.env'),
          '-f',
          path.join(f.target, 'compose.yaml'),
          'config',
          '--format',
          'json',
        ],
        { encoding: 'utf8' }
      )
    );
    assert.equal(rendered.services['matrix-sync'].environment.NODE_TLS_REJECT_UNAUTHORIZED, '1');
  }
});

test('prepare accepts simple environment lines and rejects alternate assignment syntax', async (t) => {
  const f = await fixture(t);
  for (const assignment of [
    'export MATRIX_USER_ID=@fixture:home-dev',
    'MATRIX_USER_ID: "@fixture:home-dev"',
  ]) {
    await fsp.writeFile(f.env, `${assignment}\n`);
    const result = f.invoke();
    assert.equal(JSON.parse(result.stderr).error, 'simple_env_assignments_required');
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(f.target, '.env')), false);
  }
  await fsp.writeFile(f.env, '# Integration-only example\n\nMATRIX_USER_ID="@fixture:home-dev"\n');
  assert.equal(f.invoke().status, 0);
});

test('deployment paths and revision cannot be overridden through alternate env syntax', async (t) => {
  const f = await fixture(t);
  for (const assignment of [
    `export INTEXURAOS_SOURCE_SHA=${sha}`,
    'MATRIX_SYNC_STATE_DIR: /tmp/unreviewed-state',
  ]) {
    await fsp.writeFile(f.env, `${assignment}\n`);
    const result = f.invoke();
    assert.equal(JSON.parse(result.stderr).error, 'deployment_mounts_must_be_explicit_arguments');
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(f.target, '.env')), false);
  }
});

test('rendered Compose has exactly one service on its own network and verified HTTPS trust', async (t) => {
  const f = await fixture(t);
  const result = f.invoke();
  assert.equal(result.status, 0, result.stderr);
  const compose = JSON.parse(
    execFileSync(
      'docker',
      [
        'compose',
        '--project-name',
        'intexuraos-matrix-sync',
        '--env-file',
        path.join(f.target, '.env'),
        '-f',
        path.join(f.target, 'compose.yaml'),
        'config',
        '--format',
        'json',
      ],
      { encoding: 'utf8' }
    )
  );
  assert.equal(compose.name, 'intexuraos-matrix-sync');
  assert.deepEqual(Object.keys(compose.services), ['matrix-sync']);
  const service = compose.services['matrix-sync'];
  assert.equal(service.environment.MATRIX_HOMESERVER_URL, 'https://home-dev');
  assert.equal(service.environment.NODE_EXTRA_CA_CERTS, '/run/matrix-ca/root.crt');
  assert.equal(service.environment.NODE_TLS_REJECT_UNAUTHORIZED, '1');
  assert.deepEqual(Object.keys(service.networks), ['default']);
  assert.equal(compose.networks.default.name, 'intexuraos-matrix-sync_default');
  assert.equal(service.depends_on, undefined);
  assert.deepEqual(service.extra_hosts, ['home-dev=host-gateway']);
  assert.equal(service.ports[0].host_ip, '127.0.0.1');
  assert.equal(service.ports[0].published, '8099');
  assert.equal(service.volumes.find((mount) => mount.target === '/data').source, f.state);
  assert.equal(service.user, '1000:1000');
  assert.equal(
    service.volumes.find(
      (mount) => mount.target === '/run/secrets/private-sync-service-account.json'
    ).source,
    path.join(f.secrets, 'private-sync-service-account.json')
  );
  assert.equal(
    service.volumes.find((mount) => mount.target === '/run/secrets/matrix-outbound-targets.json')
      .source,
    f.targets
  );
  assert.equal(
    service.volumes.filter((mount) => mount.target.startsWith('/run/secrets/')).length,
    4
  );
  assert.equal(
    service.volumes
      .filter((mount) => mount.target.startsWith('/run/secrets/'))
      .every((mount) => mount.read_only),
    true
  );
  assert.equal(
    service.volumes.find((mount) => mount.target === '/run/matrix-ca/root.crt').read_only,
    true
  );
  const unit = await fsp.readFile(path.join(f.target, 'intexuraos-matrix-sync.service'), 'utf8');
  assert.match(
    unit,
    /ExecStart=.*--project-name intexuraos-matrix-sync .*up --no-build --pull never --exit-code-from matrix-sync matrix-sync/
  );
  assert.match(unit, /ExecStop=.*--project-name intexuraos-matrix-sync .*stop .*matrix-sync/);
  assert.doesNotMatch(unit, /\bdown\b|remove-orphans|whatsapp-matrix\.service|synapse|postgres/);
});
