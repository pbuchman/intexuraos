import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Timestamp } from '@google-cloud/firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createFakeFirestore } from '@intexuraos/infra-firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LifecycleOperationError,
  acquireLifecycleMaintenanceLock,
  applyLifecycleJournal,
  bindLifecycleMaintenanceJournal,
  buildSummaryLifecycleJournalBatch,
  buildTaskLifecycleJournalBatch,
  decodeFirestoreValue,
  encodeFirestoreValue,
  readAndVerifyLifecycleJournal,
  prepareProductionLifecycleJournal,
  productionLifecycleEndpointsFromEnvironment,
  releaseLifecycleMaintenanceLock,
  runProductionLifecycleApplyBatch,
  runProductionLifecycleApplyResume,
  runProductionLifecycleRollback,
  rollbackLifecycleJournal,
  sanitizeLifecycleOperationResult,
  verifyProductionLifecycleWindow,
  writeImmutableLifecycleJournal,
  type LifecycleJournal,
  type ProductionLifecycleEndpoints,
} from '../../scripts/lib/productionLifecycleOperations.js';

const SHA = '1234567890abcdef1234567890abcdef12345678';
const OTHER_SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const operationId = 'op_1234567890abcdef';
const endpoints: ProductionLifecycleEndpoints = {
  directDeployment: 'https://direct.invalid/deployment.json',
  publicDeployment: 'https://public.invalid/deployment.json',
  directHealth: 'https://direct.invalid/api/code/health',
  publicHealth: 'https://public.invalid/api/code/health',
};

function deploymentBody(commitSha = SHA): Record<string, unknown> {
  return {
    commitSha,
    workflowRunId: '987654321',
    deployedAt: '2026-07-28T12:00:00Z',
  };
}

function healthBody(): Record<string, unknown> {
  return {
    status: 'ok',
    serviceName: 'code-agent',
    version: '3.8.0',
    timestamp: '2026-07-28T12:00:01.000Z',
    checks: [{ name: 'firestore', status: 'ok', latencyMs: 2, details: null }],
  };
}

function jsonResponse(body: unknown, init: { status?: number; cacheControl?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': init.cacheControl ?? 'no-cache, no-store, must-revalidate',
    },
  });
}

function sequenceFetch(responses: readonly Response[]): ReturnType<typeof vi.fn<typeof fetch>> {
  let index = 0;
  return vi.fn<typeof fetch>(async (): Promise<Response> => {
    const response = responses[index++];
    if (response === undefined) throw new Error('unexpected fetch');
    return response;
  });
}

const tempRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })));
});

describe('production lifecycle deployment window', () => {
  it('runs exact D1 → semantic H → exact D2 across direct and public endpoints', async () => {
    const fetchFn = sequenceFetch([
      jsonResponse(deploymentBody()),
      jsonResponse(deploymentBody()),
      jsonResponse(healthBody()),
      jsonResponse(healthBody()),
      jsonResponse(deploymentBody()),
      jsonResponse(deploymentBody()),
    ]);
    const now = vi.fn(() => new Date('2026-07-28T12:00:05.000Z'));

    await expect(verifyProductionLifecycleWindow({
      expectedReleaseSha: SHA,
      endpoints,
      fetchFn,
      now,
    })).resolves.toEqual({ releaseSha: SHA });
    expect(fetchFn.mock.calls.map((call) => call[0])).toEqual([
      endpoints.directDeployment,
      endpoints.publicDeployment,
      endpoints.directHealth,
      endpoints.publicHealth,
      endpoints.directDeployment,
      endpoints.publicDeployment,
    ]);
    expect(now).toHaveBeenCalled();
  });

  it('fails closed when D2 drifts after healthy code-agent responses', async () => {
    const fetchFn = sequenceFetch([
      jsonResponse(deploymentBody()),
      jsonResponse(deploymentBody()),
      jsonResponse(healthBody()),
      jsonResponse(healthBody()),
      jsonResponse(deploymentBody(OTHER_SHA)),
      jsonResponse(deploymentBody()),
    ]);

    await expect(verifyProductionLifecycleWindow({
      expectedReleaseSha: SHA,
      endpoints,
      fetchFn,
      now: () => new Date('2026-07-28T12:00:05.000Z'),
    })).rejects.toMatchObject({ code: 'DEPLOYMENT_RELEASE_MISMATCH' });
  });

  it('requires the exact three-field real deployment document contract', async () => {
    await expect(verifyProductionLifecycleWindow({
      expectedReleaseSha: SHA,
      endpoints,
      fetchFn: sequenceFetch([jsonResponse({ ...deploymentBody(), extra: true })]),
    })).rejects.toMatchObject({ code: 'DEPLOYMENT_DOCUMENT_INVALID' });
  });

  it('rejects a direct/public proof mismatch even when both advertise the expected SHA', async () => {
    await expect(verifyProductionLifecycleWindow({
      expectedReleaseSha: SHA,
      endpoints,
      fetchFn: sequenceFetch([
        jsonResponse(deploymentBody()),
        jsonResponse({ ...deploymentBody(), workflowRunId: '987654322' }),
      ]),
    })).rejects.toMatchObject({ code: 'DEPLOYMENT_PROOF_MISMATCH' });
  });

  it('rejects a same-SHA redeploy between D1 and D2', async () => {
    await expect(verifyProductionLifecycleWindow({
      expectedReleaseSha: SHA,
      endpoints,
      fetchFn: sequenceFetch([
        jsonResponse(deploymentBody()),
        jsonResponse(deploymentBody()),
        jsonResponse(healthBody()),
        jsonResponse(healthBody()),
        jsonResponse({ ...deploymentBody(), workflowRunId: '987654322' }),
        jsonResponse({ ...deploymentBody(), workflowRunId: '987654322' }),
      ]),
    })).rejects.toMatchObject({ code: 'DEPLOYMENT_PROOF_DRIFT' });
  });

  it('disables redirects and bounds a stalled proof request', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      expect(init?.redirect).toBe('error');
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });

    await expect(verifyProductionLifecycleWindow({
      expectedReleaseSha: SHA,
      endpoints,
      fetchFn,
      timeoutMs: 5,
    })).rejects.toMatchObject({ code: 'DEPLOYMENT_REQUEST_TIMEOUT' });
  });

  it.each([
    ['DEPLOYMENT_HTTP_STATUS_INVALID', jsonResponse(deploymentBody(), { status: 503 })],
    ['DEPLOYMENT_CACHE_CONTROL_INVALID', jsonResponse(deploymentBody(), { cacheControl: 'public' })],
    ['HEALTH_CHECKS_EMPTY', jsonResponse({ ...healthBody(), checks: [] })],
  ])('fails closed with stable code %s', async (code, badResponse) => {
    const isHealth = code.startsWith('HEALTH_');
    const responses = isHealth
      ? [jsonResponse(deploymentBody()), jsonResponse(deploymentBody()), badResponse]
      : [badResponse];
    await expect(verifyProductionLifecycleWindow({
      expectedReleaseSha: SHA,
      endpoints,
      fetchFn: sequenceFetch(responses),
      now: () => new Date('2026-07-28T12:00:05.000Z'),
    })).rejects.toMatchObject({ code });
  });

  it('validates endpoint environment values without accepting blanks, credentials, or other protocols', () => {
    const env = {
      INTEXURAOS_LIFECYCLE_DIRECT_DEPLOYMENT_URL: 'http://127.0.0.1:18080/deployment.json',
      INTEXURAOS_LIFECYCLE_PUBLIC_DEPLOYMENT_URL: 'https://intexuraos.cloud/deployment.json',
      INTEXURAOS_LIFECYCLE_DIRECT_HEALTH_URL: 'http://127.0.0.1:18080/api/code/health',
      INTEXURAOS_LIFECYCLE_PUBLIC_HEALTH_URL: 'https://intexuraos.cloud/api/code/health',
    };
    expect(productionLifecycleEndpointsFromEnvironment(env)).toEqual({
      directDeployment: 'http://127.0.0.1:18080/deployment.json',
      publicDeployment: 'https://intexuraos.cloud/deployment.json',
      directHealth: 'http://127.0.0.1:18080/api/code/health',
      publicHealth: 'https://intexuraos.cloud/api/code/health',
    });

    for (const value of [undefined, '   ', 'not a url', 'ftp://host/path', 'https://user@host/path', 'https://user:pass@host/path']) {
      expect(() => productionLifecycleEndpointsFromEnvironment({
        ...env,
        INTEXURAOS_LIFECYCLE_DIRECT_DEPLOYMENT_URL: value,
      })).toThrow();
    }
  });

  it.each([
    ['EXPECTED_RELEASE_SHA_INVALID', { expectedReleaseSha: 'INVALID' }],
    ['PRODUCTION_REQUEST_TIMEOUT_INVALID', { timeoutMs: 0 }],
    ['PRODUCTION_REQUEST_TIMEOUT_INVALID', { timeoutMs: 30_001 }],
    ['PRODUCTION_REQUEST_TIMEOUT_INVALID', { timeoutMs: 1.5 }],
    ['PRODUCTION_ENDPOINT_INVALID', {
      endpoints: { ...endpoints, directDeployment: '' },
    }],
  ])('rejects invalid production-window input with %s', async (code, override) => {
    await expect(verifyProductionLifecycleWindow({
      expectedReleaseSha: SHA,
      endpoints,
      fetchFn: sequenceFetch([]),
      ...override,
    })).rejects.toMatchObject({ code });
  });

  it.each([
    ['DEPLOYMENT_CONTENT_TYPE_INVALID', new Response(null, {
      headers: { 'cache-control': 'no-store' },
    })],
    ['DEPLOYMENT_CACHE_CONTROL_INVALID', new Response(JSON.stringify(deploymentBody()), {
      headers: { 'content-type': 'application/json' },
    })],
    ['DEPLOYMENT_JSON_INVALID', new Response('{', {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })],
    ['DEPLOYMENT_JSON_INVALID', new Response('null', {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })],
  ])('rejects malformed deployment response with %s', async (code, response) => {
    await expect(verifyProductionLifecycleWindow({
      expectedReleaseSha: SHA,
      endpoints,
      fetchFn: sequenceFetch([response]),
    })).rejects.toMatchObject({ code });
  });

  it('distinguishes transport failure, generic health failure, and a D2 edge mismatch', async () => {
    await expect(verifyProductionLifecycleWindow({
      expectedReleaseSha: SHA,
      endpoints,
      fetchFn: vi.fn<typeof fetch>(async (): Promise<Response> => {
        throw new Error('network unavailable');
      }),
    })).rejects.toMatchObject({ code: 'DEPLOYMENT_REQUEST_FAILED' });

    const hostileHealthResponse = {
      status: 200,
      headers: new Proxy({}, {
        ownKeys: (): never => { throw new Error('header failure'); },
      }),
      text: async (): Promise<string> => JSON.stringify(healthBody()),
    } as unknown as Response;
    await expect(verifyProductionLifecycleWindow({
      expectedReleaseSha: SHA,
      endpoints,
      fetchFn: sequenceFetch([
        jsonResponse(deploymentBody()),
        jsonResponse(deploymentBody()),
        hostileHealthResponse,
      ]),
    })).rejects.toMatchObject({ code: 'HEALTH_RESPONSE_INVALID' });

    await expect(verifyProductionLifecycleWindow({
      expectedReleaseSha: SHA,
      endpoints,
      fetchFn: sequenceFetch([
        jsonResponse(deploymentBody()),
        jsonResponse(deploymentBody()),
        jsonResponse(healthBody()),
        jsonResponse(healthBody()),
        jsonResponse(deploymentBody()),
        jsonResponse({ ...deploymentBody(), workflowRunId: '987654322' }),
      ]),
    })).rejects.toMatchObject({ code: 'DEPLOYMENT_PROOF_MISMATCH' });
  });

  it('uses default fetch, timeout, and clock on a successful proof', async () => {
    const fetchMock = sequenceFetch([
      jsonResponse(deploymentBody()),
      jsonResponse(deploymentBody()),
      jsonResponse(healthBody()),
      jsonResponse(healthBody()),
      jsonResponse(deploymentBody()),
      jsonResponse(deploymentBody()),
    ]);
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(verifyProductionLifecycleWindow({
        expectedReleaseSha: SHA,
        endpoints,
      })).resolves.toEqual({ releaseSha: SHA });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('immutable lifecycle journal', () => {
  it('creates 0700/0600 storage exclusively, fsyncs stable bytes, and preserves Timestamp nanos', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lifecycle-journal-test-'));
    tempRoots.push(root);
    const directory = join(root, 'private');
    const precise = new Timestamp(1_785_240_000, 123_456_789);
    const batch = buildTaskLifecycleJournalBatch({
      documents: [{
        id: 'task_private_1',
        data: {
          userId: 'private-user',
          title: 'private-title',
          status: 'failed',
          createdAt: precise,
          updatedAt: precise,
        },
      }],
      operationId,
      expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    });

    const written = await writeImmutableLifecycleJournal({ directory, journal: batch.journal });
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(written.path)).mode & 0o777).toBe(0o600);
    const bytes = await readFile(written.path);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(written.sha256);

    const verified = await readAndVerifyLifecycleJournal({
      path: written.path,
      expectedSha256: written.sha256,
    });
    const encodedTimestamp = verified.entries[0]?.kind === 'task'
      ? verified.entries[0].touchedFields['statusChangedAt']?.post.value
      : undefined;
    const decoded = decodeFirestoreValue(encodedTimestamp);
    expect(decoded).toBeInstanceOf(Timestamp);
    expect((decoded as Timestamp).seconds).toBe(precise.seconds);
    expect((decoded as Timestamp).nanoseconds).toBe(precise.nanoseconds);

    await expect(writeImmutableLifecycleJournal({ directory, journal: batch.journal }))
      .rejects.toMatchObject({ code: 'JOURNAL_EXISTS' });
  });

  it('rejects a byte-level journal hash mismatch before use', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lifecycle-journal-hash-'));
    tempRoots.push(root);
    const path = join(root, 'journal.json');
    await writeFile(path, '{}', { mode: 0o600 });

    await expect(readAndVerifyLifecycleJournal({ path, expectedSha256: '0'.repeat(64) }))
      .rejects.toMatchObject({ code: 'JOURNAL_HASH_MISMATCH' });
  });

  it('round-trips user maps whose keys and values resemble journal codec tags', () => {
    const precise = new Timestamp(1_785_240_000, 123_456_789);
    const source = {
      __firestoreType: 'timestamp',
      seconds: 'user-owned-seconds',
      nanoseconds: 'user-owned-nanoseconds',
      nested: {
        __firestoreType: 'bytes',
        base64: 'user-owned-base64',
      },
      items: [{ __firestoreType: 'undefined', value: 'user-owned-value' }],
      actualTimestamp: precise,
    };

    const decoded = decodeFirestoreValue(encodeFirestoreValue(source)) as typeof source;

    expect(decoded).toMatchObject({
      __firestoreType: 'timestamp',
      seconds: 'user-owned-seconds',
      nanoseconds: 'user-owned-nanoseconds',
      nested: {
        __firestoreType: 'bytes',
        base64: 'user-owned-base64',
      },
      items: [{ __firestoreType: 'undefined', value: 'user-owned-value' }],
    });
    expect(decoded.actualTimestamp).toBeInstanceOf(Timestamp);
    expect(decoded.actualTimestamp.seconds).toBe(precise.seconds);
    expect(decoded.actualTimestamp.nanoseconds).toBe(precise.nanoseconds);
  });

  it('rejects symlinked or permission-broadened journal inputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lifecycle-journal-symlink-'));
    tempRoots.push(root);
    const target = join(root, 'target.json');
    const link = join(root, 'link.json');
    await writeFile(target, '{}', { mode: 0o600 });
    await symlink(target, link);

    await expect(readAndVerifyLifecycleJournal({
      path: link,
      expectedSha256: createHash('sha256').update('{}').digest('hex'),
    })).rejects.toMatchObject({ code: 'JOURNAL_FILE_UNSAFE' });
  });

  it('stores lossless summary/count preimages and deterministic postimages with nanoseconds', () => {
    const t0 = new Timestamp(1_785_240_000, 111_222_333);
    const batchAt = new Timestamp(1_785_240_100, 987_654_321);
    const batch = buildSummaryLifecycleJournalBatch({
      taskDocuments: [{
        id: 'task_private_2',
        data: {
          userId: 'private-user',
          linearIssueId: 'INT-PRIVATE',
          status: 'failed',
          agentType: 'execution',
          createdAt: t0,
          updatedAt: t0,
          statusChangedAt: t0,
          completedAt: t0,
        },
      }],
      summaryDocuments: [{
        id: 'private-user_INT-PRIVATE',
        data: {
          userId: 'private-user',
          groupKey: 'INT-PRIVATE',
          aggregateStatus: 'done',
          customMetadata: { keep: true },
          updatedAt: t0,
        },
      }],
      countDocuments: [{
        id: 'private-user',
        data: {
          userId: 'private-user', active: 0, needsAction: 0, done: 1,
          failed: 0, archived: 0, totalGroups: 1, updatedAt: t0,
        },
      }],
      operationId,
      expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      batchTimestamp: batchAt,
    });

    expect(batch.journal.entries).toHaveLength(1);
    const entry = batch.journal.entries[0];
    expect(entry).toMatchObject({ kind: 'summary', sourceProof: expect.any(String) });
    if (entry?.kind !== 'summary') return;
    expect(entry.summary.pre).toMatchObject({ exists: true, data: expect.any(Object) });
    expect(entry.summary.post).toMatchObject({ exists: true, data: expect.any(Object) });
    expect(entry.counts.pre).toMatchObject({ exists: true, data: expect.any(Object) });
    expect(entry.counts.post).toMatchObject({ exists: true, data: expect.any(Object) });
    const decodedSummaryPost = decodeFirestoreValue(entry.summary.post.data) as Record<string, unknown>;
    const decodedCountsPost = decodeFirestoreValue(entry.counts.post.data) as Record<string, unknown>;
    expect(decodedSummaryPost['updatedAt']).toBeInstanceOf(Timestamp);
    expect((decodedSummaryPost['updatedAt'] as Timestamp).nanoseconds).toBe(batchAt.nanoseconds);
    expect(decodedCountsPost['updatedAt']).toBeInstanceOf(Timestamp);
    expect((decodedCountsPost['updatedAt'] as Timestamp).nanoseconds).toBe(batchAt.nanoseconds);
    expect((decodeFirestoreValue(entry.summary.pre.data) as Record<string, unknown>)['customMetadata'])
      .toEqual({ keep: true });
  });

  it('journals ask-only deletion and a same-status semantic update without changing counts', () => {
    const precise = new Timestamp(1_785_240_000, 111_222_333);
    const askTask = {
      id: 'task_ask_delete',
      data: {
        userId: 'ask-user', linearIssueId: 'INT-ASK', agentType: 'ask_agent', status: 'failed',
        createdAt: precise, updatedAt: precise, statusChangedAt: precise, completedAt: precise,
      },
    };
    const deletion = buildSummaryLifecycleJournalBatch({
      taskDocuments: [askTask],
      summaryDocuments: [{
        id: 'ask-user_INT-ASK',
        data: { userId: 'ask-user', groupKey: 'INT-ASK', aggregateStatus: 'done', updatedAt: precise },
      }],
      countDocuments: [{
        id: 'ask-user',
        data: {
          userId: 'ask-user', active: 0, needsAction: 0, done: 1,
          failed: 0, archived: 0, totalGroups: 1, updatedAt: precise,
        },
      }],
      operationId: 'op_ask_delete', expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'), batchTimestamp: precise,
    });
    expect(deletion.journal.entries[0]).toMatchObject({
      kind: 'summary', summary: { post: { exists: false } },
    });

    const failedTask = {
      id: 'task_same_status',
      data: {
        userId: 'same-user', linearIssueId: 'INT-SAME', agentType: 'execution', status: 'failed',
        createdAt: precise, updatedAt: precise, statusChangedAt: precise, completedAt: precise,
      },
    };
    const sameStatus = buildSummaryLifecycleJournalBatch({
      taskDocuments: [failedTask],
      summaryDocuments: [{
        id: 'same-user_INT-SAME',
        data: { userId: 'same-user', groupKey: 'INT-SAME', aggregateStatus: 'failed', updatedAt: precise },
      }],
      countDocuments: [{
        id: 'same-user',
        data: {
          userId: 'same-user', active: 0, needsAction: 0, done: 0,
          failed: 1, archived: 0, totalGroups: 1, updatedAt: precise,
        },
      }],
      operationId: 'op_same_status', expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'), batchTimestamp: precise,
    });
    const sameEntry = sameStatus.journal.entries[0];
    expect(sameEntry).toMatchObject({ kind: 'summary' });
    if (sameEntry?.kind !== 'summary') throw new Error('expected summary entry');
    expect(sameEntry.counts.post).toEqual(sameEntry.counts.pre);
  });

  it('rejects unsafe summary plans and an unknown summary cursor', () => {
    const precise = new Timestamp(1_785_240_000, 111_222_333);
    expect(() => buildSummaryLifecycleJournalBatch({
      taskDocuments: [{ id: 'task_invalid', data: { status: 'mystery' } }],
      summaryDocuments: [], countDocuments: [], operationId: 'op_invalid_summary',
      expectedReleaseSha: SHA, createdAt: new Date('2026-07-28T12:00:00.000Z'),
      batchTimestamp: precise,
    })).toThrow();

    const validTask = {
      id: 'task_cursor_source',
      data: {
        userId: 'cursor-user', linearIssueId: 'INT-CURSOR', agentType: 'execution', status: 'failed',
        createdAt: precise, updatedAt: precise, statusChangedAt: precise, completedAt: precise,
      },
    };
    expect(() => buildSummaryLifecycleJournalBatch({
      taskDocuments: [validTask], summaryDocuments: [],
      countDocuments: [{
        id: 'cursor-user',
        data: {
          userId: 'cursor-user', active: 0, needsAction: 0, done: 0,
          failed: 0, archived: 0, totalGroups: 0, updatedAt: precise,
        },
      }],
      cursor: 'group_missing', operationId: 'op_missing_cursor', expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'), batchTimestamp: precise,
    })).toThrow();
  });

  it('rejects malformed journal shapes and unsafe paths before writing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lifecycle-journal-validation-'));
    tempRoots.push(root);
    const validJournal: LifecycleJournal = {
      schemaVersion: 1, operationId: 'op_valid', phase: 'tasks', expectedReleaseSha: SHA,
      createdAt: '2026-07-28T12:00:00.000Z', hasMore: false, entries: [],
    };
    const invalidJournals: unknown[] = [
      null,
      [],
      { ...validJournal, schemaVersion: 2 },
      { ...validJournal, operationId: 'unsafe/id' },
      { ...validJournal, phase: 'all' },
      { ...validJournal, expectedReleaseSha: 'bad' },
      { ...validJournal, createdAt: 'not-a-date' },
      { ...validJournal, createdAt: 1_785_240_000 },
      { ...validJournal, hasMore: 'false' },
      { ...validJournal, entries: 'not-an-array' },
      { ...validJournal, entries: [null] },
      { ...validJournal, entries: [{ kind: 'summary' }] },
      { ...validJournal, phase: 'summaries', entries: [{ kind: 'task' }] },
    ];
    for (const journal of invalidJournals) {
      await expect(writeImmutableLifecycleJournal({
        directory: root,
        journal: journal as LifecycleJournal,
      })).rejects.toMatchObject({ code: 'JOURNAL_INVALID' });
    }

    await expect(writeImmutableLifecycleJournal({
      directory: 'relative-journals', journal: validJournal,
    })).rejects.toMatchObject({ code: 'JOURNAL_DIRECTORY_INVALID' });
    await expect(readAndVerifyLifecycleJournal({
      path: 'relative-journal.json', expectedSha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'JOURNAL_PATH_INVALID' });

    const target = join(root, 'target-directory');
    const link = join(root, 'linked-directory');
    await mkdir(target, { mode: 0o700 });
    await symlink(target, link, 'dir');
    await expect(writeImmutableLifecycleJournal({
      directory: link, journal: validJournal,
    })).rejects.toMatchObject({ code: 'JOURNAL_DIRECTORY_UNSAFE' });
  });

  it('maps a non-collision filesystem open failure to a stable write error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lifecycle-journal-io-failure-'));
    tempRoots.push(root);
    vi.resetModules();
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return {
        ...actual,
        open: async (...args: Parameters<typeof actual.open>): ReturnType<typeof actual.open> => {
          const [path] = args;
          if (String(path).endsWith('.json')) {
            throw Object.assign(new Error('forced filesystem failure'), { code: 'EIO' });
          }
          return await actual.open(...args);
        },
      };
    });
    try {
      const isolated = await import('../../scripts/lib/productionLifecycleOperations.js');
      const journal: LifecycleJournal = {
        schemaVersion: 1,
        operationId: 'op_write_failure',
        phase: 'tasks',
        expectedReleaseSha: SHA,
        createdAt: '2026-07-28T12:00:00.000Z',
        hasMore: false,
        entries: [],
      };
      await expect(isolated.writeImmutableLifecycleJournal({ directory: root, journal }))
        .rejects.toMatchObject({ code: 'JOURNAL_WRITE_FAILED' });
    } finally {
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
    }
  });

  it('sanitizes operation output to stable codes, operation/hash/counts/cursor only', () => {
    const sanitized = sanitizeLifecycleOperationResult({
      ok: true,
      operationId,
      journalSha256: 'a'.repeat(64),
      counts: { changed: 1, alreadyApplied: 0 },
      cursor: 'opaque_cursor',
      entries: [{ documentId: 'task_secret' }],
      path: '/private/task_secret.json',
      userId: 'private-user',
    });

    expect(sanitized).toEqual({
      ok: true,
      operationId,
      journalSha256: 'a'.repeat(64),
      counts: { changed: 1, alreadyApplied: 0 },
      cursor: 'opaque_cursor',
    });
    expect(JSON.stringify(sanitized)).not.toMatch(/task_secret|private-user|\/private\//u);
  });
});

describe('owner-fenced lifecycle maintenance lock', () => {
  it('allows only matching stale operation+journal proof to resume and fences the old owner', async () => {
    const fake = createFakeFirestore();
    let now = new Date('2026-07-28T12:00:00.000Z');
    const first = await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId,
      phase: 'tasks',
      expectedReleaseSha: SHA,
      now: () => now,
      randomToken: () => 'first-owner-token',
    });
    const bound = await bindLifecycleMaintenanceJournal({
      firestore: fake as unknown as Firestore,
      lock: first,
      journalSha256: 'a'.repeat(64),
      now: () => now,
    });

    await expect(acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId: 'op_wrong',
      phase: 'tasks',
      expectedReleaseSha: SHA,
      resumeJournalSha256: 'a'.repeat(64),
      now: () => now,
      randomToken: () => 'wrong-owner-token',
    })).rejects.toMatchObject({ code: 'LOCK_ACTIVE' });

    now = new Date('2026-07-28T12:31:00.000Z');
    await expect(acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId,
      phase: 'tasks',
      expectedReleaseSha: SHA,
      resumeJournalSha256: 'b'.repeat(64),
      now: () => now,
      randomToken: () => 'wrong-owner-token',
    })).rejects.toMatchObject({ code: 'LOCK_RESUME_PROOF_MISMATCH' });

    const resumed = await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId,
      phase: 'tasks',
      expectedReleaseSha: SHA,
      resumeJournalSha256: 'a'.repeat(64),
      now: () => now,
      randomToken: () => 'second-owner-token',
    });
    expect(resumed.fence).toBeGreaterThan(bound.fence);

    await expect(releaseLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      lock: bound,
    })).rejects.toMatchObject({ code: 'LOCK_FENCE_MISMATCH' });
    await expect(releaseLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      lock: resumed,
    })).resolves.toBeUndefined();
  });

  it('never automatically takes over a stale lock without exact resume proof', async () => {
    const fake = createFakeFirestore();
    const start = new Date('2026-07-28T12:00:00.000Z');
    await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId,
      phase: 'summaries',
      expectedReleaseSha: SHA,
      now: () => start,
      randomToken: () => 'owner-token',
    });

    await expect(acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId: 'op_new',
      phase: 'summaries',
      expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T13:00:00.000Z'),
      randomToken: () => 'new-token',
    })).rejects.toMatchObject({ code: 'LOCK_STALE_PROOF_REQUIRED' });
  });

  it('rejects invalid lock input and supports default owner and clock generation', async () => {
    const fake = createFakeFirestore();
    await expect(acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId: 'unsafe/id', phase: 'tasks', expectedReleaseSha: SHA,
    })).rejects.toMatchObject({ code: 'OPERATION_ID_INVALID' });
    await expect(acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId, phase: 'tasks', expectedReleaseSha: 'invalid',
    })).rejects.toMatchObject({ code: 'EXPECTED_RELEASE_SHA_INVALID' });
    await expect(acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId, phase: 'tasks', expectedReleaseSha: SHA,
      resumeJournalSha256: 'invalid',
    })).rejects.toMatchObject({ code: 'JOURNAL_SHA_INVALID' });
    await expect(acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId, phase: 'tasks', expectedReleaseSha: SHA,
      randomToken: () => 'short',
    })).rejects.toMatchObject({ code: 'LOCK_OWNER_TOKEN_INVALID' });

    const generated = await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId, phase: 'tasks', expectedReleaseSha: SHA,
    });
    expect(generated.ownerToken).toMatch(/^[0-9a-f]{64}$/u);
    await releaseLifecycleMaintenanceLock({ firestore: fake as unknown as Firestore, lock: generated });
  });

  it('validates every stale lock timestamp and fence representation', async () => {
    const now = new Date('2026-07-28T13:00:00.000Z');
    const journalSha256 = 'a'.repeat(64);
    for (const [leaseExpiresAt, fence] of [
      [undefined, 1],
      [{ toMillis: 'not-a-function' }, 1],
      [new Date('2026-07-28T12:00:00.000Z'), 'invalid'],
    ] as const) {
      const fake = createFakeFirestore();
      fake.seedCollection('code_task_lifecycle_maintenance_locks', [{
        id: 'code-task-lifecycle',
        data: {
          operationId, phase: 'tasks', expectedReleaseSha: SHA, journalSha256,
          ownerTokenHash: 'irrelevant', fence, state: 'active', leaseExpiresAt,
        },
      }]);
      await expect(acquireLifecycleMaintenanceLock({
        firestore: fake as unknown as Firestore,
        operationId, phase: 'tasks', expectedReleaseSha: SHA, resumeJournalSha256: journalSha256,
        now: () => now, randomToken: () => 'replacement-owner',
      })).rejects.toMatchObject({ code: 'LOCK_RECORD_INVALID' });
    }

    for (const leaseExpiresAt of [
      new Date('2026-07-28T12:00:00.000Z'),
      { toMillis: (): number => Date.parse('2026-07-28T12:00:00.000Z') },
    ]) {
      const fake = createFakeFirestore();
      fake.seedCollection('code_task_lifecycle_maintenance_locks', [{
        id: 'code-task-lifecycle',
        data: {
          operationId, phase: 'tasks', expectedReleaseSha: SHA, journalSha256,
          ownerTokenHash: 'irrelevant', fence: 1, state: 'active', leaseExpiresAt,
        },
      }]);
      await expect(acquireLifecycleMaintenanceLock({
        firestore: fake as unknown as Firestore,
        operationId, phase: 'tasks', expectedReleaseSha: SHA, resumeJournalSha256: journalSha256,
        now: () => now, randomToken: () => 'replacement-owner',
      })).resolves.toMatchObject({ fence: 2 });
    }
  });

  it('fails closed when binding or releasing a missing, changed, or differently bound lock', async () => {
    const missing = createFakeFirestore();
    const missingLock = {
      operationId, phase: 'tasks' as const, expectedReleaseSha: SHA,
      ownerToken: 'missing-owner-token', fence: 1,
    };
    await expect(bindLifecycleMaintenanceJournal({
      firestore: missing as unknown as Firestore,
      lock: missingLock, journalSha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'LOCK_FENCE_MISMATCH' });
    await expect(releaseLifecycleMaintenanceLock({
      firestore: missing as unknown as Firestore, lock: missingLock,
    })).rejects.toMatchObject({ code: 'LOCK_FENCE_MISMATCH' });

    const fake = createFakeFirestore();
    const acquired = await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId, phase: 'tasks', expectedReleaseSha: SHA,
      randomToken: () => 'bound-owner-token',
    });
    const bound = await bindLifecycleMaintenanceJournal({
      firestore: fake as unknown as Firestore,
      lock: acquired, journalSha256: 'a'.repeat(64),
    });
    await expect(bindLifecycleMaintenanceJournal({
      firestore: fake as unknown as Firestore,
      lock: acquired, journalSha256: 'a'.repeat(64),
    })).resolves.toMatchObject({ journalSha256: 'a'.repeat(64) });
    await expect(bindLifecycleMaintenanceJournal({
      firestore: fake as unknown as Firestore,
      lock: acquired, journalSha256: 'b'.repeat(64),
    })).rejects.toMatchObject({ code: 'LOCK_JOURNAL_MISMATCH' });

    await fake.collection('code_task_lifecycle_maintenance_locks')
      .doc('code-task-lifecycle').update({ journalSha256: 'b'.repeat(64) });
    await expect(releaseLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore, lock: bound,
    })).rejects.toMatchObject({ code: 'LOCK_JOURNAL_MISMATCH' });
  });
});

describe('journal CAS apply and rollback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:01.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies pre→post, rolls back in reverse post→pre, and never overwrites unrelated fields', async () => {
    const fake = createFakeFirestore();
    const precise = new Timestamp(1_785_240_000, 987_654_321);
    fake.seedCollection('code_tasks', [{
      id: 'task_private_1',
      data: {
        userId: 'private-user',
        title: 'keep-this-title',
        status: 'failed',
        createdAt: precise,
        updatedAt: precise,
      },
    }]);
    const batch = buildTaskLifecycleJournalBatch({
      documents: [{
        id: 'task_private_1',
        data: {
          userId: 'private-user',
          title: 'keep-this-title',
          status: 'failed',
          createdAt: precise,
          updatedAt: precise,
        },
      }],
      operationId,
      expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    });
    const journalHash = createHash('sha256').update(JSON.stringify(batch.journal)).digest('hex');
    const lock = await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId,
      phase: 'tasks',
      expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
      randomToken: () => 'owner-token',
    });
    const bound = await bindLifecycleMaintenanceJournal({
      firestore: fake as unknown as Firestore,
      lock,
      journalSha256: journalHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });

    await expect(applyLifecycleJournal({
      firestore: fake as unknown as Firestore,
      journal: batch.journal,
      journalSha256: journalHash,
      lock: bound,
      now: () => new Date('2026-07-28T12:00:01.000Z'),
    })).resolves.toMatchObject({ changed: 1, alreadyApplied: 0 });
    await expect(applyLifecycleJournal({
      firestore: fake as unknown as Firestore,
      journal: batch.journal,
      journalSha256: journalHash,
      lock: bound,
      now: () => new Date('2026-07-28T12:00:02.000Z'),
    })).resolves.toMatchObject({ changed: 0, alreadyApplied: 1 });

    await expect(rollbackLifecycleJournal({
      firestore: fake as unknown as Firestore,
      journal: batch.journal,
      journalSha256: journalHash,
      lock: bound,
      now: () => new Date('2026-07-28T12:00:03.000Z'),
    })).resolves.toMatchObject({ reverted: 1, alreadyReverted: 0 });
    const restored = await fake.collection('code_tasks').doc('task_private_1').get();
    expect(restored.get('statusChangedAt')).toBeUndefined();
    expect(restored.get('completedAt')).toBeUndefined();
    expect(restored.get('title')).toBe('keep-this-title');

    await expect(rollbackLifecycleJournal({
      firestore: fake as unknown as Firestore,
      journal: batch.journal,
      journalSha256: journalHash,
      lock: bound,
      now: () => new Date('2026-07-28T12:00:04.000Z'),
    })).resolves.toMatchObject({ reverted: 0, alreadyReverted: 1 });
  });

  it('stops on CAS conflict instead of performing a blind restore', async () => {
    const fake = createFakeFirestore();
    const precise = new Timestamp(1_785_240_000, 987_654_321);
    const source = {
      userId: 'private-user', status: 'failed', createdAt: precise, updatedAt: precise,
    };
    fake.seedCollection('code_tasks', [{ id: 'task_private_1', data: source }]);
    const batch = buildTaskLifecycleJournalBatch({
      documents: [{ id: 'task_private_1', data: source }],
      operationId,
      expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    });
    const journalHash = createHash('sha256').update(JSON.stringify(batch.journal)).digest('hex');
    const lock = await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId,
      phase: 'tasks',
      expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
      randomToken: () => 'owner-token',
    });
    const bound = await bindLifecycleMaintenanceJournal({
      firestore: fake as unknown as Firestore,
      lock,
      journalSha256: journalHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    await applyLifecycleJournal({
      firestore: fake as unknown as Firestore,
      journal: batch.journal,
      journalSha256: journalHash,
      lock: bound,
      now: () => new Date('2026-07-28T12:00:01.000Z'),
    });
    await fake.collection('code_tasks').doc('task_private_1').update({
      completedAt: new Timestamp(1_785_240_001, 1),
    });

    await expect(rollbackLifecycleJournal({
      firestore: fake as unknown as Firestore,
      journal: batch.journal,
      journalSha256: journalHash,
      lock: bound,
      now: () => new Date('2026-07-28T12:00:02.000Z'),
    })).rejects.toMatchObject({ code: 'JOURNAL_CAS_CONFLICT' });
  });

  it('preflights every entry before rollback so a later conflict cannot cause a partial restore', async () => {
    const fake = createFakeFirestore();
    const precise = new Timestamp(1_785_240_000, 987_654_321);
    const sources = ['task_private_1', 'task_private_2'].map((id) => ({
      id,
      data: { userId: 'private-user', status: 'failed', createdAt: precise, updatedAt: precise },
    }));
    fake.seedCollection('code_tasks', sources);
    const batch = buildTaskLifecycleJournalBatch({
      documents: sources,
      operationId,
      expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    });
    const journalHash = createHash('sha256').update(JSON.stringify(batch.journal)).digest('hex');
    const lock = await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId,
      phase: 'tasks',
      expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
      randomToken: () => 'owner-token',
    });
    const bound = await bindLifecycleMaintenanceJournal({
      firestore: fake as unknown as Firestore,
      lock,
      journalSha256: journalHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    await applyLifecycleJournal({
      firestore: fake as unknown as Firestore,
      journal: batch.journal,
      journalSha256: journalHash,
      lock: bound,
      now: () => new Date('2026-07-28T12:00:01.000Z'),
    });
    await fake.collection('code_tasks').doc('task_private_1').update({
      completedAt: new Timestamp(1_785_240_001, 1),
    });

    await expect(rollbackLifecycleJournal({
      firestore: fake as unknown as Firestore,
      journal: batch.journal,
      journalSha256: journalHash,
      lock: bound,
      now: () => new Date('2026-07-28T12:00:02.000Z'),
    })).rejects.toMatchObject({ code: 'JOURNAL_CAS_CONFLICT' });
    const wouldHaveBeenFirst = await fake.collection('code_tasks').doc('task_private_2').get();
    expect(wouldHaveBeenFirst.get('statusChangedAt')).toBeInstanceOf(Timestamp);
    expect(wouldHaveBeenFirst.get('completedAt')).toBeInstanceOf(Timestamp);
  });

  it('rolls back the complete journal in one atomic transaction', async () => {
    const fake = createFakeFirestore();
    const precise = new Timestamp(1_785_240_000, 987_654_321);
    const sources = ['task_private_atomic_1', 'task_private_atomic_2'].map((id) => ({
      id,
      data: { userId: 'private-user', status: 'failed', createdAt: precise, updatedAt: precise },
    }));
    fake.seedCollection('code_tasks', sources);
    const batch = buildTaskLifecycleJournalBatch({
      documents: sources,
      operationId: 'op_atomic_rollback',
      expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    });
    const journalHash = createHash('sha256').update(JSON.stringify(batch.journal)).digest('hex');
    const lock = await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId: batch.journal.operationId,
      phase: 'tasks',
      expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
      randomToken: () => 'owner-token',
    });
    const bound = await bindLifecycleMaintenanceJournal({
      firestore: fake as unknown as Firestore,
      lock,
      journalSha256: journalHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    await applyLifecycleJournal({
      firestore: fake as unknown as Firestore,
      journal: batch.journal,
      journalSha256: journalHash,
      lock: bound,
      now: () => new Date('2026-07-28T12:00:01.000Z'),
    });
    const runTransaction = vi.spyOn(fake, 'runTransaction');

    await expect(rollbackLifecycleJournal({
      firestore: fake as unknown as Firestore,
      journal: batch.journal,
      journalSha256: journalHash,
      lock: bound,
      now: () => new Date('2026-07-28T12:00:02.000Z'),
    })).resolves.toMatchObject({ reverted: 2, alreadyReverted: 0 });

    expect(runTransaction).toHaveBeenCalledTimes(1);
  });

  it('preflights chained summary count postimages in reverse per user', async () => {
    const fake = createFakeFirestore();
    const precise = new Timestamp(1_785_240_000, 987_654_321);
    const taskDocuments = ['INT-CHAIN-A', 'INT-CHAIN-B'].map((groupKey, index) => ({
      id: `task_chain_${String(index)}`,
      data: {
        userId: 'private-user', linearIssueId: groupKey, status: 'failed', agentType: 'execution',
        createdAt: precise, updatedAt: precise, statusChangedAt: precise, completedAt: precise,
      },
    }));
    const summaryDocuments = ['INT-CHAIN-A', 'INT-CHAIN-B'].map((groupKey) => ({
      id: `private-user_${groupKey}`,
      data: { userId: 'private-user', groupKey, aggregateStatus: 'done', updatedAt: precise },
    }));
    const countDocuments = [{
      id: 'private-user',
      data: {
        userId: 'private-user', active: 0, needsAction: 0, done: 2,
        failed: 0, archived: 0, totalGroups: 2, updatedAt: precise,
      },
    }];
    fake.seedCollection('code_tasks', taskDocuments);
    fake.seedCollection('task_group_summaries', summaryDocuments);
    fake.seedCollection('user_group_counts', countDocuments);
    const batch = buildSummaryLifecycleJournalBatch({
      taskDocuments, summaryDocuments, countDocuments,
      operationId: 'op_summary_chain', expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      batchTimestamp: precise,
    });
    expect(batch.journal.entries).toHaveLength(2);
    const journalHash = createHash('sha256').update(JSON.stringify(batch.journal)).digest('hex');
    const lock = await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId: batch.journal.operationId, phase: 'summaries', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'), randomToken: () => 'owner-token',
    });
    const bound = await bindLifecycleMaintenanceJournal({
      firestore: fake as unknown as Firestore, lock, journalSha256: journalHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    await applyLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: bound,
      now: () => new Date('2026-07-28T12:00:01.000Z'),
    });
    await fake.collection('task_group_summaries').doc('private-user_INT-CHAIN-A').update({
      independentMetadata: 'preserve-summary',
    });
    await fake.collection('user_group_counts').doc('private-user').update({
      independentMetadata: 'preserve-counts',
    });

    await expect(rollbackLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: bound,
      now: () => new Date('2026-07-28T12:00:02.000Z'),
    })).resolves.toMatchObject({ reverted: 2 });
    const restoredSummary = await fake.collection('task_group_summaries')
      .doc('private-user_INT-CHAIN-A').get();
    const restored = await fake.collection('user_group_counts').doc('private-user').get();
    expect(restoredSummary.get('independentMetadata')).toBe('preserve-summary');
    expect(restored.get('independentMetadata')).toBe('preserve-counts');
    expect(restored.data()).toMatchObject({ done: 2, failed: 0, totalGroups: 2 });
  });

  it('fails task apply on lock mismatch, missing target, source drift, CAS conflict, and expiry', async () => {
    const fake = createFakeFirestore();
    const precise = new Timestamp(1_785_240_000, 987_654_321);
    const source = {
      userId: 'private-user', status: 'failed', createdAt: precise, updatedAt: precise,
    };
    const batch = buildTaskLifecycleJournalBatch({
      documents: [{ id: 'task_guarded', data: source }],
      operationId: 'op_task_guards', expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    });
    const journalHash = createHash('sha256').update(JSON.stringify(batch.journal)).digest('hex');
    const lock = await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId: batch.journal.operationId, phase: 'tasks', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'), randomToken: () => 'guard-owner-token',
    });
    const bound = await bindLifecycleMaintenanceJournal({
      firestore: fake as unknown as Firestore, lock, journalSha256: journalHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });

    await expect(applyLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: { ...bound, journalSha256: 'b'.repeat(64) },
    })).rejects.toMatchObject({ code: 'LOCK_JOURNAL_MISMATCH' });
    await expect(rollbackLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: { ...bound, journalSha256: 'b'.repeat(64) },
    })).rejects.toMatchObject({ code: 'LOCK_JOURNAL_MISMATCH' });
    await expect(applyLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: bound,
      now: () => new Date('2026-07-28T12:00:01.000Z'),
    })).rejects.toMatchObject({ code: 'JOURNAL_CAS_CONFLICT' });

    fake.seedCollection('code_tasks', [{ id: 'task_guarded', data: { ...source, status: 'archived' } }]);
    await expect(applyLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: bound,
      now: () => new Date('2026-07-28T12:00:01.000Z'),
    })).rejects.toMatchObject({ code: 'JOURNAL_SOURCE_PROOF_MISMATCH' });

    fake.seedCollection('code_tasks', [{
      id: 'task_guarded', data: { ...source, completedAt: new Timestamp(1_785_240_001, 1) },
    }]);
    await expect(applyLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: bound,
      now: () => new Date('2026-07-28T12:00:01.000Z'),
    })).rejects.toMatchObject({ code: 'JOURNAL_CAS_CONFLICT' });

    fake.seedCollection('code_tasks', [{ id: 'task_guarded', data: source }]);
    await expect(applyLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: bound,
      now: () => new Date('2026-07-28T12:31:00.000Z'),
    })).rejects.toMatchObject({ code: 'LOCK_LEASE_EXPIRED' });

    await fake.collection('code_task_lifecycle_maintenance_locks').doc('code-task-lifecycle').delete();
    await expect(applyLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: bound,
    })).rejects.toMatchObject({ code: 'LOCK_FENCE_MISMATCH' });
  });

  it('rolls back a duplicated task entry with a present preimage and rejects missing/source-drifted tasks', async () => {
    const precise = new Timestamp(1_785_240_000, 987_654_321);
    const source = {
      userId: 'private-user', status: 'failed', createdAt: precise, updatedAt: precise,
    };
    const built = buildTaskLifecycleJournalBatch({
      documents: [{ id: 'task_duplicate', data: source }],
      operationId: 'op_task_duplicate', expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    });
    const taskEntry = built.journal.entries[0];
    if (taskEntry?.kind !== 'task') throw new Error('expected task entry');
    const presentPreimage = new Timestamp(1_785_239_999, 123_456_789);
    const statusChanged = taskEntry.touchedFields['statusChangedAt'];
    if (statusChanged === undefined) throw new Error('expected statusChangedAt transition');
    statusChanged.pre = { present: true, value: encodeFirestoreValue(presentPreimage) };
    built.journal.entries = [taskEntry, taskEntry];
    const current: Record<string, unknown> = { ...source };
    for (const [field, states] of Object.entries(taskEntry.touchedFields)) {
      current[field] = decodeFirestoreValue(states.post.value);
    }

    const fake = createFakeFirestore();
    fake.seedCollection('code_tasks', [{ id: taskEntry.documentId, data: current }]);
    const journalHash = createHash('sha256').update(JSON.stringify(built.journal)).digest('hex');
    const lock = await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId: built.journal.operationId, phase: 'tasks', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'), randomToken: () => 'duplicate-owner-token',
    });
    const bound = await bindLifecycleMaintenanceJournal({
      firestore: fake as unknown as Firestore, lock, journalSha256: journalHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    await expect(rollbackLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: built.journal,
      journalSha256: journalHash, lock: bound,
    })).resolves.toEqual({ reverted: 1, alreadyReverted: 1 });
    expect((await fake.collection('code_tasks').doc(taskEntry.documentId).get()).get('statusChangedAt'))
      .toEqual(presentPreimage);

    const missing = createFakeFirestore();
    const missingLock = await acquireLifecycleMaintenanceLock({
      firestore: missing as unknown as Firestore,
      operationId: built.journal.operationId, phase: 'tasks', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'), randomToken: () => 'missing-owner-token',
    });
    const missingBound = await bindLifecycleMaintenanceJournal({
      firestore: missing as unknown as Firestore, lock: missingLock, journalSha256: journalHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    await expect(rollbackLifecycleJournal({
      firestore: missing as unknown as Firestore, journal: built.journal,
      journalSha256: journalHash, lock: missingBound,
    })).rejects.toMatchObject({ code: 'JOURNAL_CAS_CONFLICT' });

    const drifted = createFakeFirestore();
    drifted.seedCollection('code_tasks', [{
      id: taskEntry.documentId, data: { ...current, status: 'archived' },
    }]);
    const driftLock = await acquireLifecycleMaintenanceLock({
      firestore: drifted as unknown as Firestore,
      operationId: built.journal.operationId, phase: 'tasks', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'), randomToken: () => 'drift-owner-token',
    });
    const driftBound = await bindLifecycleMaintenanceJournal({
      firestore: drifted as unknown as Firestore, lock: driftLock, journalSha256: journalHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    await expect(rollbackLifecycleJournal({
      firestore: drifted as unknown as Firestore, journal: built.journal,
      journalSha256: journalHash, lock: driftBound,
    })).rejects.toMatchObject({ code: 'JOURNAL_SOURCE_PROOF_MISMATCH' });
  });

  it('applies and idempotently rolls back a standalone summary created from no prior document', async () => {
    const fake = createFakeFirestore();
    const precise = new Timestamp(1_785_240_000, 987_654_321);
    const task = {
      id: 'task_standalone',
      data: {
        userId: 'standalone-user', status: 'failed', agentType: 'execution',
        createdAt: precise, updatedAt: precise, statusChangedAt: precise, completedAt: precise,
      },
    };
    const counts = {
      id: 'standalone-user',
      data: {
        userId: 'standalone-user', active: 0, needsAction: 0, done: 0,
        failed: 0, archived: 0, totalGroups: 0, updatedAt: precise,
      },
    };
    fake.seedCollection('code_tasks', [task]);
    fake.seedCollection('user_group_counts', [counts]);
    const batch = buildSummaryLifecycleJournalBatch({
      taskDocuments: [task], summaryDocuments: [], countDocuments: [counts],
      operationId: 'op_standalone', expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'), batchTimestamp: precise,
    });
    const entry = batch.journal.entries[0];
    expect(entry).toMatchObject({ kind: 'summary', summary: { pre: { exists: false } } });
    if (entry === undefined) throw new Error('expected standalone summary entry');
    batch.journal.entries = [entry, entry];
    const journalHash = createHash('sha256').update(JSON.stringify(batch.journal)).digest('hex');
    const lock = await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId: batch.journal.operationId, phase: 'summaries', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'), randomToken: () => 'standalone-owner',
    });
    const bound = await bindLifecycleMaintenanceJournal({
      firestore: fake as unknown as Firestore, lock, journalSha256: journalHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });

    await expect(applyLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: bound,
    })).resolves.toEqual({ changed: 1, alreadyApplied: 1 });
    await expect(applyLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: bound,
    })).resolves.toEqual({ changed: 0, alreadyApplied: 2 });
    await expect(rollbackLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: bound,
    })).resolves.toEqual({ reverted: 1, alreadyReverted: 1 });
    await expect(rollbackLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: bound,
    })).resolves.toEqual({ reverted: 0, alreadyReverted: 2 });

    await fake.collection('code_tasks').doc(task.id).delete();
    await expect(rollbackLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: bound,
    })).rejects.toMatchObject({ code: 'JOURNAL_SOURCE_PROOF_MISMATCH' });
  });

  it('restores an ask-only deletion and preserves an unchanged count transition', async () => {
    const precise = new Timestamp(1_785_240_000, 987_654_321);
    const askTask = {
      id: 'task_ask_restore',
      data: {
        userId: 'ask-restore-user', linearIssueId: 'INT-ASK-RESTORE', agentType: 'ask_agent',
        status: 'failed', createdAt: precise, updatedAt: precise,
        statusChangedAt: precise, completedAt: precise,
      },
    };
    const askSummary = {
      id: 'ask-restore-user_INT-ASK-RESTORE',
      data: {
        userId: 'ask-restore-user', groupKey: 'INT-ASK-RESTORE',
        aggregateStatus: 'done', updatedAt: precise,
      },
    };
    const askCounts = {
      id: 'ask-restore-user',
      data: {
        userId: 'ask-restore-user', active: 0, needsAction: 0, done: 1,
        failed: 0, archived: 0, totalGroups: 1, updatedAt: precise,
      },
    };
    const deletion = buildSummaryLifecycleJournalBatch({
      taskDocuments: [askTask], summaryDocuments: [askSummary], countDocuments: [askCounts],
      operationId: 'op_ask_restore', expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'), batchTimestamp: precise,
    });
    const fake = createFakeFirestore();
    fake.seedCollection('code_tasks', [askTask]);
    fake.seedCollection('task_group_summaries', [askSummary]);
    fake.seedCollection('user_group_counts', [askCounts]);
    const deletionHash = createHash('sha256').update(JSON.stringify(deletion.journal)).digest('hex');
    const deletionLock = await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId: deletion.journal.operationId, phase: 'summaries', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'), randomToken: () => 'ask-owner-token',
    });
    const deletionBound = await bindLifecycleMaintenanceJournal({
      firestore: fake as unknown as Firestore, lock: deletionLock, journalSha256: deletionHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    await applyLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: deletion.journal,
      journalSha256: deletionHash, lock: deletionBound,
    });
    await expect(rollbackLifecycleJournal({
      firestore: fake as unknown as Firestore, journal: deletion.journal,
      journalSha256: deletionHash, lock: deletionBound,
    })).resolves.toMatchObject({ reverted: 1 });
    expect((await fake.collection('task_group_summaries').doc(askSummary.id).get()).exists).toBe(true);

    const sameTask = {
      id: 'task_same_restore',
      data: {
        userId: 'same-restore-user', linearIssueId: 'INT-SAME-RESTORE', agentType: 'execution',
        status: 'failed', createdAt: precise, updatedAt: precise,
        statusChangedAt: precise, completedAt: precise,
      },
    };
    const sameSummary = {
      id: 'same-restore-user_INT-SAME-RESTORE',
      data: {
        userId: 'same-restore-user', groupKey: 'INT-SAME-RESTORE',
        aggregateStatus: 'failed', updatedAt: precise,
      },
    };
    const sameCounts = {
      id: 'same-restore-user',
      data: {
        userId: 'same-restore-user', active: 0, needsAction: 0, done: 0,
        failed: 1, archived: 0, totalGroups: 1, updatedAt: precise,
      },
    };
    const same = buildSummaryLifecycleJournalBatch({
      taskDocuments: [sameTask], summaryDocuments: [sameSummary], countDocuments: [sameCounts],
      operationId: 'op_same_restore', expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'), batchTimestamp: precise,
    });
    const sameFake = createFakeFirestore();
    sameFake.seedCollection('code_tasks', [sameTask]);
    sameFake.seedCollection('task_group_summaries', [sameSummary]);
    sameFake.seedCollection('user_group_counts', [sameCounts]);
    const sameHash = createHash('sha256').update(JSON.stringify(same.journal)).digest('hex');
    const sameLock = await acquireLifecycleMaintenanceLock({
      firestore: sameFake as unknown as Firestore,
      operationId: same.journal.operationId, phase: 'summaries', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'), randomToken: () => 'same-owner-token',
    });
    const sameBound = await bindLifecycleMaintenanceJournal({
      firestore: sameFake as unknown as Firestore, lock: sameLock, journalSha256: sameHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    await applyLifecycleJournal({
      firestore: sameFake as unknown as Firestore, journal: same.journal,
      journalSha256: sameHash, lock: sameBound,
    });
    await expect(rollbackLifecycleJournal({
      firestore: sameFake as unknown as Firestore, journal: same.journal,
      journalSha256: sameHash, lock: sameBound,
    })).resolves.toMatchObject({ reverted: 1 });
  });

  it('rejects standalone source loss, summary CAS drift, and missing rollback documents', async () => {
    const precise = new Timestamp(1_785_240_000, 987_654_321);
    const task = {
      id: 'task_summary_guards',
      data: {
        userId: 'summary-guard-user', linearIssueId: 'INT-SUMMARY-GUARDS',
        agentType: 'execution', status: 'failed', createdAt: precise, updatedAt: precise,
        statusChangedAt: precise, completedAt: precise,
      },
    };
    const summary = {
      id: 'summary-guard-user_INT-SUMMARY-GUARDS',
      data: {
        userId: 'summary-guard-user', groupKey: 'INT-SUMMARY-GUARDS',
        aggregateStatus: 'done', updatedAt: precise,
      },
    };
    const counts = {
      id: 'summary-guard-user',
      data: {
        userId: 'summary-guard-user', active: 0, needsAction: 0, done: 1,
        failed: 0, archived: 0, totalGroups: 1, updatedAt: precise,
      },
    };
    const batch = buildSummaryLifecycleJournalBatch({
      taskDocuments: [task], summaryDocuments: [summary], countDocuments: [counts],
      operationId: 'op_summary_guards', expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'), batchTimestamp: precise,
    });
    const entry = batch.journal.entries[0];
    if (entry?.kind !== 'summary') throw new Error('expected summary entry');
    const journalHash = createHash('sha256').update(JSON.stringify(batch.journal)).digest('hex');

    const sourceMissing = createFakeFirestore();
    sourceMissing.seedCollection('task_group_summaries', [summary]);
    sourceMissing.seedCollection('user_group_counts', [counts]);
    const missingLock = await acquireLifecycleMaintenanceLock({
      firestore: sourceMissing as unknown as Firestore,
      operationId: batch.journal.operationId, phase: 'summaries', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'), randomToken: () => 'source-missing-owner',
    });
    const missingBound = await bindLifecycleMaintenanceJournal({
      firestore: sourceMissing as unknown as Firestore, lock: missingLock, journalSha256: journalHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    await expect(applyLifecycleJournal({
      firestore: sourceMissing as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: missingBound,
    })).rejects.toMatchObject({ code: 'JOURNAL_SOURCE_PROOF_MISMATCH' });

    const applyConflict = createFakeFirestore();
    applyConflict.seedCollection('code_tasks', [task]);
    applyConflict.seedCollection('task_group_summaries', [{
      id: summary.id, data: { ...summary.data, aggregateStatus: 'archived' },
    }]);
    applyConflict.seedCollection('user_group_counts', [counts]);
    const conflictLock = await acquireLifecycleMaintenanceLock({
      firestore: applyConflict as unknown as Firestore,
      operationId: batch.journal.operationId, phase: 'summaries', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'), randomToken: () => 'summary-conflict-owner',
    });
    const conflictBound = await bindLifecycleMaintenanceJournal({
      firestore: applyConflict as unknown as Firestore, lock: conflictLock, journalSha256: journalHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    await expect(applyLifecycleJournal({
      firestore: applyConflict as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: conflictBound,
    })).rejects.toMatchObject({ code: 'JOURNAL_CAS_CONFLICT' });

    const rollbackSourceDrift = createFakeFirestore();
    rollbackSourceDrift.seedCollection('code_tasks', [{
      id: task.id, data: { ...task.data, status: 'archived' },
    }]);
    rollbackSourceDrift.seedCollection('task_group_summaries', [{
      id: summary.id, data: decodeFirestoreValue(entry.summary.post.data) as Record<string, unknown>,
    }]);
    rollbackSourceDrift.seedCollection('user_group_counts', [{
      id: counts.id, data: decodeFirestoreValue(entry.counts.post.data) as Record<string, unknown>,
    }]);
    const sourceDriftLock = await acquireLifecycleMaintenanceLock({
      firestore: rollbackSourceDrift as unknown as Firestore,
      operationId: batch.journal.operationId, phase: 'summaries', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'), randomToken: () => 'rollback-source-drift',
    });
    const sourceDriftBound = await bindLifecycleMaintenanceJournal({
      firestore: rollbackSourceDrift as unknown as Firestore,
      lock: sourceDriftLock, journalSha256: journalHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    await expect(rollbackLifecycleJournal({
      firestore: rollbackSourceDrift as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: sourceDriftBound,
    })).rejects.toMatchObject({ code: 'JOURNAL_SOURCE_PROOF_MISMATCH' });

    const rollbackMissing = createFakeFirestore();
    rollbackMissing.seedCollection('code_tasks', [task]);
    rollbackMissing.seedCollection('user_group_counts', [{
      id: counts.id, data: decodeFirestoreValue(entry.counts.post.data) as Record<string, unknown>,
    }]);
    const rollbackLock = await acquireLifecycleMaintenanceLock({
      firestore: rollbackMissing as unknown as Firestore,
      operationId: batch.journal.operationId, phase: 'summaries', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'), randomToken: () => 'rollback-missing-owner',
    });
    const rollbackBound = await bindLifecycleMaintenanceJournal({
      firestore: rollbackMissing as unknown as Firestore, lock: rollbackLock, journalSha256: journalHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    await expect(rollbackLifecycleJournal({
      firestore: rollbackMissing as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: rollbackBound,
    })).rejects.toMatchObject({ code: 'JOURNAL_CAS_CONFLICT' });

    rollbackMissing.seedCollection('task_group_summaries', [{
      id: summary.id, data: decodeFirestoreValue(entry.summary.post.data) as Record<string, unknown>,
    }]);
    await rollbackMissing.collection('user_group_counts').doc(counts.id).delete();
    await expect(rollbackLifecycleJournal({
      firestore: rollbackMissing as unknown as Firestore, journal: batch.journal,
      journalSha256: journalHash, lock: rollbackBound,
    })).rejects.toMatchObject({ code: 'JOURNAL_CAS_CONFLICT' });
  });

  it('rejects malformed encoded summary preimages and handles an absent no-op count document', async () => {
    const precise = new Timestamp(1_785_240_000, 987_654_321);
    const task = {
      id: 'task_encoded_guards',
      data: {
        userId: 'encoded-user', linearIssueId: 'INT-ENCODED', agentType: 'execution',
        status: 'failed', createdAt: precise, updatedAt: precise,
        statusChangedAt: precise, completedAt: precise,
      },
    };
    const summary = {
      id: 'encoded-user_INT-ENCODED',
      data: { userId: 'encoded-user', groupKey: 'INT-ENCODED', aggregateStatus: 'done', updatedAt: precise },
    };
    const counts = {
      id: 'encoded-user',
      data: {
        userId: 'encoded-user', active: 0, needsAction: 0, done: 1,
        failed: 0, archived: 0, totalGroups: 1, updatedAt: precise,
      },
    };
    const built = buildSummaryLifecycleJournalBatch({
      taskDocuments: [task], summaryDocuments: [summary], countDocuments: [counts],
      operationId: 'op_encoded_guards', expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'), batchTimestamp: precise,
    });
    const originalEntry = built.journal.entries[0];
    if (originalEntry?.kind !== 'summary') throw new Error('expected summary entry');

    for (const malformedData of [undefined, null, []]) {
      const malformedJournal = structuredClone(built.journal);
      const malformedEntry = malformedJournal.entries[0];
      if (malformedEntry?.kind !== 'summary') throw new Error('expected summary entry');
      malformedEntry.summary.pre = { exists: true, data: malformedData };
      const fake = createFakeFirestore();
      fake.seedCollection('code_tasks', [task]);
      fake.seedCollection('task_group_summaries', [{
        id: summary.id,
        data: decodeFirestoreValue(originalEntry.summary.post.data) as Record<string, unknown>,
      }]);
      fake.seedCollection('user_group_counts', [{
        id: counts.id,
        data: decodeFirestoreValue(originalEntry.counts.post.data) as Record<string, unknown>,
      }]);
      const hash = createHash('sha256').update(JSON.stringify(malformedJournal)).digest('hex');
      const lock = await acquireLifecycleMaintenanceLock({
        firestore: fake as unknown as Firestore,
        operationId: malformedJournal.operationId, phase: 'summaries', expectedReleaseSha: SHA,
        now: () => new Date('2026-07-28T12:00:00.000Z'), randomToken: () => 'malformed-owner',
      });
      const bound = await bindLifecycleMaintenanceJournal({
        firestore: fake as unknown as Firestore, lock, journalSha256: hash,
        now: () => new Date('2026-07-28T12:00:00.000Z'),
      });
      await expect(rollbackLifecycleJournal({
        firestore: fake as unknown as Firestore, journal: malformedJournal,
        journalSha256: hash, lock: bound,
      })).rejects.toMatchObject({ code: 'JOURNAL_VALUE_INVALID' });
    }

    const absentCountsJournal = structuredClone(built.journal);
    const absentCountsEntry = absentCountsJournal.entries[0];
    if (absentCountsEntry?.kind !== 'summary') throw new Error('expected summary entry');
    absentCountsEntry.counts = { pre: { exists: false }, post: { exists: false } };
    const absentFake = createFakeFirestore();
    absentFake.seedCollection('code_tasks', [task]);
    absentFake.seedCollection('task_group_summaries', [{
      id: summary.id,
      data: decodeFirestoreValue(originalEntry.summary.post.data) as Record<string, unknown>,
    }]);
    const absentHash = createHash('sha256').update(JSON.stringify(absentCountsJournal)).digest('hex');
    const absentLock = await acquireLifecycleMaintenanceLock({
      firestore: absentFake as unknown as Firestore,
      operationId: absentCountsJournal.operationId, phase: 'summaries', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'), randomToken: () => 'absent-counts-owner',
    });
    const absentBound = await bindLifecycleMaintenanceJournal({
      firestore: absentFake as unknown as Firestore, lock: absentLock, journalSha256: absentHash,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    await expect(rollbackLifecycleJournal({
      firestore: absentFake as unknown as Firestore, journal: absentCountsJournal,
      journalSha256: absentHash, lock: absentBound,
    })).resolves.toMatchObject({ reverted: 1 });
  });
});

describe('production journal paging', () => {
  it('uses limit+1, advances across skipped tasks, and ends without a stale cursor', async () => {
    const fake = createFakeFirestore();
    const precise = new Timestamp(1_785_240_000, 123_456_789);
    fake.seedCollection('code_tasks', Array.from({ length: 202 }, (_, index) => ({
      id: `task_${String(index).padStart(3, '0')}`,
      data: {
        status: 'running', createdAt: precise, updatedAt: precise, statusChangedAt: precise,
      },
    })));
    const first = await prepareProductionLifecycleJournal({
      firestore: fake as unknown as Firestore,
      phase: 'tasks', pageSize: 200, limit: 200,
      operationId: 'op_task_page_1', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    expect(first.entries).toHaveLength(0);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toMatch(/^task_[A-Za-z0-9_-]{43}$/u);
    expect(first.cursor).not.toBe('task_199');
    expect(first.cursor).not.toContain('199');

    const repeated = await prepareProductionLifecycleJournal({
      firestore: fake as unknown as Firestore,
      phase: 'tasks', pageSize: 40, limit: 200,
      operationId: 'op_task_page_repeat', expectedReleaseSha: SHA,
    });
    expect(repeated.cursor).toBe(first.cursor);
    expect(new Date(repeated.createdAt).toISOString()).toBe(repeated.createdAt);

    const last = await prepareProductionLifecycleJournal({
      firestore: fake as unknown as Firestore,
      phase: 'tasks', pageSize: 200, limit: 200,
      ...(first.cursor !== undefined && { cursor: first.cursor }),
      operationId: 'op_task_page_2', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:01.000Z'),
    });
    expect(last.entries).toHaveLength(0);
    expect(last.hasMore).toBe(false);
    expect(last).not.toHaveProperty('cursor');
    expect(last.operationId).not.toBe(first.operationId);

    await expect(prepareProductionLifecycleJournal({
      firestore: fake as unknown as Firestore,
      phase: 'tasks', pageSize: 200, limit: 200, cursor: 'task_199',
      operationId: 'op_task_raw_cursor', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:02.000Z'),
    })).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
  });

  it('advances over 200 unchanged summary work items before a later change', async () => {
    const fake = createFakeFirestore();
    const precise = new Timestamp(1_785_240_000, 123_456_789);
    const workKey = (groupKey: string): string => `group_${createHash('sha256')
      .update(`group\0${JSON.stringify(['private-user', groupKey])}`)
      .digest('base64url')}`;
    const candidates = Array.from({ length: 201 }, (_, index) => `INT-${String(index).padStart(3, '0')}`)
      .sort((left, right) => workKey(left) < workKey(right) ? -1 : workKey(left) > workKey(right) ? 1 : 0);
    const changedGroup = candidates[200] as string;
    const askGroups = candidates.slice(0, 200);
    fake.seedCollection('code_tasks', [
      ...askGroups.map((groupKey, index) => ({
        id: `task_ask_${String(index).padStart(3, '0')}`,
        data: {
          userId: 'private-user', linearIssueId: groupKey, status: 'failed', agentType: 'ask_agent',
          createdAt: precise, updatedAt: precise, statusChangedAt: precise, completedAt: precise,
        },
      })),
      {
        id: 'task_changed',
        data: {
          userId: 'private-user', linearIssueId: changedGroup, status: 'failed', agentType: 'execution',
          createdAt: precise, updatedAt: precise, statusChangedAt: precise, completedAt: precise,
        },
      },
    ]);
    fake.seedCollection('user_group_counts', [{
      id: 'private-user',
      data: {
        userId: 'private-user', active: 0, needsAction: 0, done: 0,
        failed: 0, archived: 0, totalGroups: 0, updatedAt: precise,
      },
    }]);

    const first = await prepareProductionLifecycleJournal({
      firestore: fake as unknown as Firestore,
      phase: 'summaries', pageSize: 200, limit: 200,
      operationId: 'op_summary_page_1', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    expect(first.entries).toHaveLength(0);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toBe(workKey(askGroups[199] as string));

    const last = await prepareProductionLifecycleJournal({
      firestore: fake as unknown as Firestore,
      phase: 'summaries', pageSize: 200, limit: 200,
      ...(first.cursor !== undefined && { cursor: first.cursor }),
      operationId: 'op_summary_page_2', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:01.000Z'),
    });
    expect(last.entries).toHaveLength(1);
    expect(last.hasMore).toBe(false);
    expect(last).not.toHaveProperty('cursor');
  });
});

describe('production apply and rollback orchestration', () => {
  it('repeats D1→H→D2 after durable journal creation and before the first write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lifecycle-apply-order-'));
    tempRoots.push(root);
    const fake = createFakeFirestore();
    const precise = new Timestamp(1_785_240_000, 123_456_789);
    const source = { userId: 'private-user', status: 'failed', createdAt: precise, updatedAt: precise };
    fake.seedCollection('code_tasks', [{ id: 'task_private_3', data: source }]);
    const batch = buildTaskLifecycleJournalBatch({
      documents: [{ id: 'task_private_3', data: source }],
      operationId,
      expectedReleaseSha: SHA,
      hasMore: true,
      nextDocumentId: 'task_private_3',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    });
    let requestCount = 0;
    const fetchFn = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      requestCount++;
      if (requestCount === 7) {
        const beforeFirstWrite = await fake.collection('code_tasks').doc('task_private_3').get();
        expect(beforeFirstWrite.get('statusChangedAt')).toBeUndefined();
      }
      return String(url).includes('/health')
        ? jsonResponse(healthBody())
        : jsonResponse(deploymentBody());
    });

    const result = await runProductionLifecycleApplyBatch({
      firestore: fake as unknown as Firestore,
      journal: batch.journal,
      journalDirectory: join(root, 'journal'),
      endpoints,
      fetchFn,
      now: () => new Date('2026-07-28T12:00:05.000Z'),
      randomToken: () => 'owner-token',
    });

    expect(fetchFn).toHaveBeenCalledTimes(12);
    expect(result).toMatchObject({
      ok: true,
      operationId,
      journalSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      counts: { changed: 1, alreadyApplied: 0 },
      cursor: expect.stringMatching(/^task_[A-Za-z0-9_-]{43}$/u),
    });
  });

  it('verifies journal hash before rollback gates or mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lifecycle-rollback-hash-'));
    tempRoots.push(root);
    const fake = createFakeFirestore();
    const path = join(root, 'journal.json');
    await writeFile(path, '{}', { mode: 0o600 });
    const fetchFn = vi.fn(async (): Promise<Response> => jsonResponse(deploymentBody()));

    await expect(runProductionLifecycleRollback({
      firestore: fake as unknown as Firestore,
      journalPath: path,
      expectedJournalSha256: '0'.repeat(64),
      expectedReleaseSha: SHA,
      endpoints,
      fetchFn,
      now: () => new Date('2026-07-28T12:00:05.000Z'),
      randomToken: () => 'rollback-owner-token',
    })).rejects.toMatchObject({ code: 'JOURNAL_HASH_MISMATCH' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('durably creates an orphan journal before a competing lock can reject the batch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lifecycle-journal-before-lock-'));
    tempRoots.push(root);
    const fake = createFakeFirestore();
    const precise = new Timestamp(1_785_240_000, 123_456_789);
    const source = { status: 'failed', createdAt: precise, updatedAt: precise };
    fake.seedCollection('code_tasks', [{ id: 'task_private_4', data: source }]);
    const batch = buildTaskLifecycleJournalBatch({
      documents: [{ id: 'task_private_4', data: source }],
      operationId: 'op_orphan_safe',
      expectedReleaseSha: SHA,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    });
    await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId: 'op_competing', phase: 'tasks', expectedReleaseSha: SHA,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
      randomToken: () => 'competing-owner-token',
    });
    const journalDirectory = join(root, 'journal');

    await expect(runProductionLifecycleApplyBatch({
      firestore: fake as unknown as Firestore,
      journal: batch.journal,
      journalDirectory,
      endpoints,
      fetchFn: sequenceFetch(Array.from({ length: 6 }, (_, index) =>
        jsonResponse(index === 2 || index === 3 ? healthBody() : deploymentBody()))),
      now: () => new Date('2026-07-28T12:00:01.000Z'),
      randomToken: () => 'rejected-owner-token',
    })).rejects.toMatchObject({ code: 'LOCK_ACTIVE' });

    await expect(stat(join(journalDirectory, 'op_orphan_safe-tasks.json'))).resolves.toBeDefined();
    const unchanged = await fake.collection('code_tasks').doc('task_private_4').get();
    expect(unchanged.get('statusChangedAt')).toBeUndefined();
  });

  it('resumes a partially applied journal idempotently after the exact bound lease expires', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lifecycle-apply-resume-'));
    tempRoots.push(root);
    const fake = createFakeFirestore();
    const precise = new Timestamp(1_785_240_000, 123_456_789);
    const documents = ['task_private_5', 'task_private_6'].map((id) => ({
      id, data: { status: 'failed', createdAt: precise, updatedAt: precise },
    }));
    fake.seedCollection('code_tasks', documents);
    const batch = buildTaskLifecycleJournalBatch({
      documents,
      operationId: 'op_resume_safe',
      expectedReleaseSha: SHA,
      hasMore: true,
      nextDocumentId: 'task_private_6',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    });
    const written = await writeImmutableLifecycleJournal({
      directory: join(root, 'journal'),
      journal: batch.journal,
    });
    await acquireLifecycleMaintenanceLock({
      firestore: fake as unknown as Firestore,
      operationId: batch.journal.operationId,
      phase: batch.journal.phase,
      expectedReleaseSha: SHA,
      resumeJournalSha256: written.sha256,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
      randomToken: () => 'crashed-owner-token',
    });
    const first = batch.journal.entries[0];
    if (first?.kind !== 'task') throw new Error('expected task entry');
    await fake.collection('code_tasks').doc(first.documentId).update(Object.fromEntries(
      Object.entries(first.touchedFields).map(([field, states]) => [
        field, decodeFirestoreValue(states.post.value),
      ]),
    ));

    const result = await runProductionLifecycleApplyResume({
      firestore: fake as unknown as Firestore,
      journalPath: written.path,
      expectedJournalSha256: written.sha256,
      expectedReleaseSha: SHA,
      endpoints,
      fetchFn: sequenceFetch(Array.from({ length: 12 }, (_, index) =>
        jsonResponse(index % 6 === 2 || index % 6 === 3 ? healthBody() : deploymentBody()))),
      now: () => new Date('2026-07-28T12:31:00.000Z'),
      randomToken: () => 'resumed-owner-token',
    });

    expect(result).toMatchObject({
      counts: { changed: 1, alreadyApplied: 1 },
      cursor: expect.stringMatching(/^task_[A-Za-z0-9_-]{43}$/u),
    });
    for (const document of documents) {
      const snapshot = await fake.collection('code_tasks').doc(document.id).get();
      expect(snapshot.get('statusChangedAt')).toBeInstanceOf(Timestamp);
      expect(snapshot.get('completedAt')).toBeInstanceOf(Timestamp);
    }
  });

  it('runs high-level rollback with explicit and default dependencies and preserves its cursor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lifecycle-high-level-rollback-'));
    tempRoots.push(root);
    const fake = createFakeFirestore();
    const precise = new Timestamp(1_785_240_000, 123_456_789);
    const source = { status: 'failed', createdAt: precise, updatedAt: precise };
    fake.seedCollection('code_tasks', [{ id: 'task_high_level_rollback', data: source }]);
    const batch = buildTaskLifecycleJournalBatch({
      documents: [{ id: 'task_high_level_rollback', data: source }],
      operationId: 'op_high_level_rollback', expectedReleaseSha: SHA,
      hasMore: true, nextDocumentId: 'task_high_level_rollback',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    });
    const journalDirectory = join(root, 'journal');
    const applied = await runProductionLifecycleApplyBatch({
      firestore: fake as unknown as Firestore,
      journal: batch.journal, journalDirectory, endpoints,
      fetchFn: sequenceFetch(Array.from({ length: 12 }, (_, index) =>
        jsonResponse(index % 6 === 2 || index % 6 === 3 ? healthBody() : deploymentBody()))),
      now: () => new Date('2026-07-28T12:00:01.000Z'), randomToken: () => 'apply-owner-token',
    });
    const journalSha256 = String(applied['journalSha256']);
    const journalPath = join(journalDirectory, 'op_high_level_rollback-tasks.json');

    await expect(runProductionLifecycleApplyResume({
      firestore: fake as unknown as Firestore,
      journalPath, expectedJournalSha256: journalSha256, expectedReleaseSha: OTHER_SHA,
      endpoints, fetchFn: sequenceFetch([]),
    })).rejects.toMatchObject({ code: 'JOURNAL_RELEASE_MISMATCH' });
    await expect(runProductionLifecycleRollback({
      firestore: fake as unknown as Firestore,
      journalPath, expectedJournalSha256: journalSha256, expectedReleaseSha: OTHER_SHA,
      endpoints, fetchFn: sequenceFetch([]),
    })).rejects.toMatchObject({ code: 'JOURNAL_RELEASE_MISMATCH' });

    const reverted = await runProductionLifecycleRollback({
      firestore: fake as unknown as Firestore,
      journalPath, expectedJournalSha256: journalSha256, expectedReleaseSha: SHA,
      endpoints,
      fetchFn: sequenceFetch(Array.from({ length: 12 }, (_, index) =>
        jsonResponse(index % 6 === 2 || index % 6 === 3 ? healthBody() : deploymentBody()))),
      now: () => new Date('2026-07-28T12:00:02.000Z'), randomToken: () => 'rollback-owner-token',
    });
    expect(reverted).toMatchObject({
      counts: { reverted: 1, alreadyReverted: 0 },
      cursor: expect.stringMatching(/^task_[A-Za-z0-9_-]{43}$/u),
    });

    const defaultFetch = sequenceFetch(Array.from({ length: 12 }, (_, index) =>
      jsonResponse(index % 6 === 2 || index % 6 === 3 ? healthBody() : deploymentBody())));
    vi.stubGlobal('fetch', defaultFetch);
    try {
      await expect(runProductionLifecycleRollback({
        firestore: fake as unknown as Firestore,
        journalPath, expectedJournalSha256: journalSha256, expectedReleaseSha: SHA, endpoints,
      })).resolves.toMatchObject({ counts: { reverted: 0, alreadyReverted: 1 } });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// Compile-time guard: journals are the only object allowed to carry private entries.
const _journalContract: LifecycleJournal | undefined = undefined;
void _journalContract;
void LifecycleOperationError;
