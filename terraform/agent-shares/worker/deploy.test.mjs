import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerDirectory = fileURLToPath(new URL('.', import.meta.url));
const deployScript = fileURLToPath(new URL('./deploy.mjs', import.meta.url));
const serviceOrigin = 'https://intexuraos-agent-shares-origin-123456.europe-central2.run.app';

test('deployment passes the validated origin and sole custom domain to Wrangler', (t) => {
  const bin = mkdtempSync(join(workerDirectory, '.wrangler-test-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(
    join(bin, 'wrangler'),
    '#!/bin/sh\n[ -f "$3" ] || exit 9\nprintf "%s\\n" "$@"\nexit "${FAKE_EXIT:-0}"\n',
    {
      mode: 0o700,
    }
  );
  const deploy = (args, fakeExit = '0') =>
    spawnSync(process.execPath, [deployScript, ...args], {
      encoding: 'utf8',
      env: { PATH: bin, FAKE_EXIT: fakeExit },
    });

  const deployment = deploy([`${serviceOrigin}/`]);
  assert.equal(deployment.status, 0, deployment.stderr);
  const expectedArgs = [
    'deploy',
    '--config',
    'wrangler.json',
    '--var',
    `FUNCTION_ORIGIN:${serviceOrigin}`,
  ];
  assert.deepEqual(deployment.stdout.trim().split('\n'), expectedArgs);

  const dryRun = deploy([serviceOrigin, '--dry-run']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.deepEqual(dryRun.stdout.trim().split('\n'), [...expectedArgs, '--dry-run']);

  assert.equal(deploy([serviceOrigin], '7').status, 7);
  for (const invalid of [
    [],
    ['https://example.com'],
    [`${serviceOrigin}/nested`],
    [serviceOrigin, '--env'],
  ]) {
    const rejected = deploy(invalid);
    assert.equal(rejected.status, 2);
    assert.equal(rejected.stdout, '');
  }

  const config = JSON.parse(readFileSync(new URL('./wrangler.json', import.meta.url), 'utf8'));
  assert.equal(config.main, 'index.mjs');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, [{ pattern: 'share.intexuraos.cloud', custom_domain: true }]);
});
