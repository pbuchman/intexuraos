import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import {
  buildHealthPayload,
  createConfig,
  createHealthServer,
  runSyncIteration,
} from './server.mjs';

const now = '2026-10-12T10:00:00.000Z';
const config = createConfig({});
const readiness = {
  hasMatrixAccessToken: true,
  hasOidcCredentials: true,
  runtimeState: 'running',
  counters: {},
  lastSuccessfulIterationAt: now,
};

test('health requires a running, completed iteration less than 120 seconds old', () => {
  for (const runtimeState of [
    'starting',
    'initializing',
    'error',
    'recovery_required',
    'media_degraded',
  ]) {
    assert.equal(
      buildHealthPayload(config, { ...readiness, runtimeState }, Date.parse(now)).ok,
      false
    );
  }
  for (const delta of [0, 119_999]) {
    assert.equal(buildHealthPayload(config, readiness, Date.parse(now) + delta).ok, true);
  }
  for (const lastSuccessfulIterationAt of [undefined, 'bad-date', '2026-10-12T09:58:00.000Z']) {
    const payload = buildHealthPayload(
      config,
      { ...readiness, lastSuccessfulIterationAt },
      Date.parse(now)
    );
    assert.equal(payload.ok, false);
    assert.equal(payload.state, 'stale');
  }
  assert.equal(
    buildHealthPayload(config, { ...readiness, hasMatrixAccessToken: false }, Date.parse(now)).ok,
    false
  );
  assert.equal(
    buildHealthPayload(config, { ...readiness, hasOidcCredentials: false }, Date.parse(now)).ok,
    false
  );
  assert.equal(
    buildHealthPayload(config, { ...readiness, counters: { mediaPending: 1 } }, Date.parse(now)).ok,
    false
  );
  assert.equal(
    buildHealthPayload(config, { ...readiness, lastError: 'failed_ingest' }, Date.parse(now)).ok,
    false
  );
});

test('retrying a failed poll keeps its failure visible until a complete quiet iteration', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'matrix-health-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const runtime = { state: 'error', lastError: 'matrix_sync_failed_503', counters: {} };
  let releasePoll;
  const iteration = runSyncIteration(
    { ...config, pendingMediaFile: path.join(directory, 'pending.json') },
    runtime,
    {
      hasMaintenanceFence: () => false,
      readAccessToken: () => 'matrix-token',
      hasNonEmptyFile: () => true,
      readSyncState: async () => ({ nextBatch: 's0' }),
      fetchMatrixSync: () =>
        new Promise((resolve) => {
          releasePoll = resolve;
        }),
      writeSyncState: async () => {},
      nowISOString: () => now,
    }
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.state, 'error');
  assert.equal(runtime.lastError, 'matrix_sync_failed_503');
  releasePoll({ next_batch: 's1', rooms: {} });
  await iteration;
  assert.equal(runtime.state, 'running');
  assert.equal(runtime.lastError, undefined);
  assert.equal(runtime.lastSuccessfulPollAt, now);
  assert.equal(runtime.lastCheckpointAt, now);
  assert.equal(runtime.lastSuccessfulIterationAt, now);
  assert.equal(runtime.lastIngestAt, undefined);
  assert.equal(
    buildHealthPayload(
      config,
      { ...readiness, ...runtime, runtimeState: runtime.state },
      Date.parse(now)
    ).ok,
    true
  );
});

test('incomplete poll never records a successful iteration or checkpoint', async () => {
  const runtime = { state: 'starting', counters: {} };
  let checkpointWrites = 0;
  await assert.rejects(
    runSyncIteration(config, runtime, {
      hasMaintenanceFence: () => false,
      readAccessToken: () => 'matrix-token',
      hasNonEmptyFile: () => true,
      readSyncState: async () => ({ nextBatch: 's0' }),
      fetchMatrixSync: async () => ({ rooms: {} }),
      writeSyncState: async () => {
        checkpointWrites += 1;
      },
      nowISOString: () => now,
    }),
    /matrix_sync_missing_next_batch/
  );
  assert.equal(checkpointWrites, 0);
  assert.equal(runtime.lastSuccessfulIterationAt, undefined);
});

test('authorized health uses 503 for every blocked state and 200 for fresh quiet progress', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'matrix-health-http-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  for (const [name, contents] of [
    ['matrix', 'matrix-token'],
    ['bearer', 'health-token'],
    ['google.json', '{}'],
  ]) {
    await fsp.writeFile(path.join(directory, name), contents);
  }
  const runtime = { state: 'starting', counters: {} };
  const server = createHealthServer(
    {
      ...config,
      matrixAccessTokenFile: path.join(directory, 'matrix'),
      matrixOutboundAuthTokenFile: path.join(directory, 'bearer'),
      googleApplicationCredentialsFile: path.join(directory, 'google.json'),
      maintenanceFenceFile: path.join(directory, 'fence'),
    },
    runtime
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/health`;
  const runCheck = (tokenFile = path.join(directory, 'bearer')) =>
    promisify(execFile)(
      process.execPath,
      [new URL('./healthcheck.mjs', import.meta.url).pathname],
      {
        env: {
          ...process.env,
          PORT: String(server.address().port),
          MATRIX_OUTBOUND_AUTH_TOKEN_FILE: tokenFile,
        },
      }
    );
  assert.equal((await fetch(url)).status, 401);
  for (const state of [
    'starting',
    'initializing',
    'error',
    'recovery_required',
    'media_degraded',
    'running',
  ]) {
    runtime.state = state;
    assert.equal(
      (await fetch(url, { headers: { authorization: 'Bearer health-token' } })).status,
      503,
      state
    );
  }
  runtime.lastSuccessfulIterationAt = new Date().toISOString();
  const response = await fetch(url, { headers: { authorization: 'Bearer health-token' } });
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).lastSuccessfulIterationAt,
    runtime.lastSuccessfulIterationAt
  );
  await runCheck();
  await fsp.writeFile(path.join(directory, 'fence'), 'fixture-maintenance');
  assert.equal(
    (await fetch(url, { headers: { authorization: 'Bearer health-token' } })).status,
    503
  );
  await fsp.unlink(path.join(directory, 'fence'));
  runtime.state = 'recovery_required';
  await assert.rejects(
    runCheck(),
    (error) => error.code === 1 && !error.stderr.includes('health-token')
  );
  await assert.rejects(runCheck(path.join(directory, 'missing')), (error) => error.code === 1);
});
