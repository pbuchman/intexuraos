import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Timestamp } from '@google-cloud/firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createFakeFirestore } from '@intexuraos/infra-firestore';
import {
  EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
  LifecycleBackfillRunError,
  aggregateTaskLifecyclePlans,
  buildSummaryReconciliationPlan,
  parseLifecycleBackfillArgs,
  planRawCodeTaskLifecycle,
  runCodeTaskLifecycleBackfill,
  runSummaryLifecycleBackfillPhase,
  runTaskLifecycleBackfillPhase,
  validateLifecycleBackfillEnvironment,
  type RawFirestoreDocument,
} from '../../scripts/lib/codeTaskLifecycleBackfill.js';
import {
  executeCodeTaskLifecycleBackfillCli,
  runCodeTaskLifecycleBackfillMain,
} from '../../scripts/backfillCodeTaskLifecycleTime.js';
import { runLegacyGroupSummaryBackfillMain } from '../../scripts/backfillGroupSummaries.js';

const timestamp = (iso: string): Timestamp => Timestamp.fromDate(new Date(iso));
const t0 = timestamp('2026-07-27T08:00:00.000Z');
const t1 = timestamp('2026-07-27T08:05:00.000Z');
const t2 = timestamp('2026-07-27T08:10:00.000Z');

function rawTask(
  id: string,
  overrides: Record<string, unknown> = {},
): RawFirestoreDocument {
  return {
    id,
    data: {
      userId: 'user-1',
      status: 'archived',
      agentType: 'execution',
      createdAt: t0,
      updatedAt: t2,
      ...overrides,
    },
  };
}

function seedRawTasks(
  fake: ReturnType<typeof createFakeFirestore>,
  tasks: readonly RawFirestoreDocument[],
): void {
  fake.seedCollection('code_tasks', tasks.map((task) => ({ id: task.id, data: task.data })));
}

function validCredential(projectId = EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID): string {
  return JSON.stringify({
    type: 'service_account',
    project_id: projectId,
    client_email: `migration@${projectId}.iam.gserviceaccount.com`,
    private_key: 'canary-private-key-that-must-never-be-reported',
  });
}

describe('raw lifecycle planning', () => {
  it('plans from raw fields and adds only absent canonical fields using one exact resolved timestamp', () => {
    const dispatchAt = new Timestamp(1_753_602_019, 625_123_456);
    const input = rawTask('task-failed', {
      status: 'failed',
      dispatchStatus: { terminal: true, lastSeenAt: dispatchAt },
      prompt: 'private prompt',
      error: { message: 'private error' },
    });

    const plan = planRawCodeTaskLifecycle(input);

    expect(plan).toEqual({
      docId: 'task-failed',
      outcome: 'change',
      source: 'dispatch_terminal',
      terminal: true,
      activeCompletedAtAnomaly: false,
      update: { statusChangedAt: dispatchAt, completedAt: dispatchAt },
    });
    expect(input.data).not.toHaveProperty('statusChangedAt');
    expect(input.data).not.toHaveProperty('completedAt');
    expect(Object.keys(plan.outcome === 'change' ? plan.update : {})).toEqual([
      'statusChangedAt',
      'completedAt',
    ]);
  });

  it('preserves valid canonical timestamps exactly and adds only a missing terminal completion', () => {
    const canonical = new Timestamp(253_402_300_799, 999_999_999);
    const plan = planRawCodeTaskLifecycle(rawTask('task-max', {
      statusChangedAt: canonical,
    }));

    expect(plan.outcome).toBe('change');
    if (plan.outcome !== 'change') return;
    expect(plan.source).toBe('status_changed');
    expect(plan.update).toEqual({ completedAt: expect.any(Timestamp) });
    expect(plan.update.completedAt?.seconds).toBe(253_402_300_799);
    expect(plan.update.completedAt?.nanoseconds).toBe(999_999_999);
    expect(plan.update).not.toHaveProperty('statusChangedAt');
  });

  it.each([
    ['status_changed_at_invalid', { statusChangedAt: undefined }],
    ['status_changed_at_invalid', { statusChangedAt: null }],
    ['status_changed_at_invalid', { statusChangedAt: 'not-a-time' }],
    ['completed_at_invalid', { completedAt: undefined }],
    ['completed_at_invalid', { completedAt: null }],
    ['completed_at_invalid', { completedAt: 'not-a-time' }],
  ])('treats present malformed canonical data as %s instead of replacing it', (reason, fields) => {
    const plan = planRawCodeTaskLifecycle(rawTask(`task-${String(reason)}`, fields));

    expect(plan).toEqual({
      docId: `task-${String(reason)}`,
      outcome: 'invalid',
      reason,
    });
  });

  it('reports but does not remove an anomalous completedAt on an active task', () => {
    const completedAt = new Timestamp(1_753_602_019, 999_888_777);
    const plan = planRawCodeTaskLifecycle(rawTask('task-running', {
      status: 'running',
      statusChangedAt: t1,
      completedAt,
      dispatchedAt: t0,
    }));

    expect(plan).toEqual({
      docId: 'task-running',
      outcome: 'skip',
      source: 'status_changed',
      terminal: false,
      activeCompletedAtAnomaly: true,
    });
  });

  it('treats raw legacy completed as terminal and chooses its exact completedAt over later updatedAt', () => {
    const completedAt = new Timestamp(1_773_886_013, 707_000_000);
    const plan = planRawCodeTaskLifecycle(rawTask(
      'task_76d13dde-c6d9-4c08-86c4-5589f1c8dcf2',
      {
        status: 'completed',
        completedAt,
        updatedAt: timestamp('2026-03-19T02:14:34.998Z'),
      },
    ));

    expect(plan.outcome).toBe('change');
    if (plan.outcome !== 'change') return;
    expect(plan.source).toBe('completed');
    expect(plan.update).toEqual({ statusChangedAt: expect.any(Timestamp) });
    expect(plan.update.statusChangedAt?.seconds).toBe(completedAt.seconds);
    expect(plan.update.statusChangedAt?.nanoseconds).toBe(completedAt.nanoseconds);
  });

  it.each([
    ['task_488aa3c6-1413-47ea-a1c7-9593e5aca5a2', '2026-07-26T15:20:19.625Z', '2026-07-26T15:23:48.130Z'],
    ['task_6713e082-4806-41a0-b0f2-763db07404f1', '2026-07-26T16:06:08.528Z', '2026-07-26T16:10:05.139Z'],
    ['task_95ecfbc5-233d-4a1f-b7ad-e6a0223f6fd4', '2026-07-26T17:29:12.901Z', '2026-07-26T17:33:22.832Z'],
    ['task_e8d7ab84-33fb-4746-8c77-4a1b95823f0c', '2026-07-26T19:04:18.159Z', '2026-07-26T19:07:53.347Z'],
    ['task_a5d59442-06c5-47f4-8f2a-d03489e655ce', '2026-07-27T00:07:03.728Z', '2026-07-27T00:07:03.787Z'],
    ['task_166001f8-3d65-4397-932d-9c930363e338', '2026-07-27T12:28:15.885Z', '2026-07-27T12:35:09.634Z'],
  ])('uses the real auth dispatch failure time for %s', (id, failureIso, laterUpdateIso) => {
    const failureAt = timestamp(failureIso);
    const plan = planRawCodeTaskLifecycle(rawTask(id, {
      status: 'failed',
      updatedAt: timestamp(laterUpdateIso),
      dispatchStatus: {
        terminal: true,
        lastSeenAt: failureAt,
        terminalReason: 'codex_auth_unavailable',
      },
    }));

    expect(plan.outcome).toBe('change');
    if (plan.outcome !== 'change') return;
    expect(plan.source).toBe('dispatch_terminal');
    expect(plan.update.statusChangedAt).toEqual(failureAt);
    expect(plan.update.completedAt).toEqual(failureAt);
  });

  it('encodes the complete observed production task totals without reading production', () => {
    const tasks: RawFirestoreDocument[] = [];
    for (let index = 0; index < 4_447; index++) {
      const status = index < 4_440 ? 'archived' : index < 4_446 ? 'failed' : 'completed';
      const fields: Record<string, unknown> = { status };
      if (index < 4_141 || index === 4_446) {
        fields['completedAt'] = new Timestamp(1_700_000_000 + index, index);
      } else if (index < 4_191) fields['dispatchStatus'] = {
        terminal: true,
        lastSeenAt: new Timestamp(1_700_000_000 + index, index),
      };
      tasks.push(rawTask(`task_${String(index).padStart(4, '0')}`, fields));
    }

    const totals = aggregateTaskLifecyclePlans(tasks.map(planRawCodeTaskLifecycle));

    expect(totals).toMatchObject({
      scanned: 4_447,
      changed: 4_447,
      invalid: 0,
      statusChangedAtAdded: 4_447,
      completedAtAdded: 305,
      sources: {
        completed: 4_142,
        dispatch_terminal: 50,
        legacy_updated: 255,
      },
    });
  });

  it('reports invalid status and an unresolvable lifecycle without synthesizing data', () => {
    const invalidStatus = planRawCodeTaskLifecycle({
      id: 'task-invalid-status',
      data: { status: 'mystery', createdAt: t0 },
    });
    const unresolvable = planRawCodeTaskLifecycle({
      id: 'task-unresolvable',
      data: { status: 'running' },
    });
    const anomalousSkip = planRawCodeTaskLifecycle(rawTask('task-anomalous-skip', {
      status: 'running', statusChangedAt: t1, completedAt: t2,
    }));

    expect(invalidStatus).toMatchObject({ outcome: 'invalid', reason: 'status_invalid' });
    expect(unresolvable).toMatchObject({ outcome: 'invalid', reason: 'lifecycle_unresolvable' });
    expect(aggregateTaskLifecyclePlans([
      invalidStatus,
      invalidStatus,
      unresolvable,
      anomalousSkip,
    ])).toMatchObject({
      scanned: 4,
      invalid: 3,
      skipped: 1,
      activeCompletedAtAnomalies: 1,
      invalidReasons: { status_invalid: 2, lifecycle_unresolvable: 1 },
    });
    expect(aggregateTaskLifecyclePlans([
      planRawCodeTaskLifecycle(rawTask('task-completion-only', { statusChangedAt: t1 })),
    ])).toMatchObject({ changed: 1, statusChangedAtAdded: 0, completedAtAdded: 1 });
  });
});

describe('argument and environment safety gates', () => {
  it('defaults to dry-run while requiring the exact explicit retained-production project', () => {
    expect(parseLifecycleBackfillArgs([
      `--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`,
    ])).toEqual({
      mode: 'dry-run',
      phase: 'all',
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      pageSize: 200,
    });
    expect(() => parseLifecycleBackfillArgs([])).toThrowError('PROJECT_REQUIRED');
    expect(() => parseLifecycleBackfillArgs(['--project=some-other-project'])).toThrowError('PROJECT_MISMATCH');
  });

  it.each([
    ['unknown flag', [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--force']],
    ['conflicting modes', [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--apply', '--dry-run']],
    ['duplicate flag', [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks', '--phase=summaries']],
    ['all cursor', [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--cursor=task_1']],
    ['empty cursor', [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks', '--cursor=']],
    ['blank cursor', [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks', '--cursor=   ']],
    ['path cursor', [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks', '--cursor=tasks/task_1']],
    ['page zero', [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--page-size=0']],
    ['page too large', [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--page-size=201']],
    ['fractional page', [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--page-size=1.5']],
    ['limit zero', [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--limit=0']],
    ['invalid phase', [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=other']],
    ['mode value', [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--apply=yes']],
    ['project without value', ['--project']],
    ['unsafe integer limit', [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--limit=999999999999999999999']],
  ])('rejects %s', (_name, argv) => {
    expect(() => parseLifecycleBackfillArgs(argv)).toThrow();
  });

  it('parses explicit apply, phase, cursor, page size, and limit', () => {
    expect(parseLifecycleBackfillArgs([
      `--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`,
      '--apply',
      '--phase=tasks',
      '--cursor=task_0042',
      '--page-size=37',
      '--limit=101',
    ])).toEqual({
      mode: 'apply',
      phase: 'tasks',
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      cursor: 'task_0042',
      pageSize: 37,
      limit: 101,
    });
    expect(parseLifecycleBackfillArgs([
      `--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`,
      '--dry-run',
      '--phase=summaries',
    ])).toMatchObject({ mode: 'dry-run', phase: 'summaries' });
  });

  it.each([
    ['CREDENTIALS_REQUIRED', {}, validCredential()],
    ['CREDENTIALS_INVALID_JSON', { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' }, '{private-key-canary'],
    ['CREDENTIALS_NOT_SERVICE_ACCOUNT', { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' }, JSON.stringify({ type: 'authorized_user' })],
    ['CREDENTIALS_PROJECT_MISMATCH', { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' }, validCredential('other-project')],
    ['CREDENTIALS_CLIENT_EMAIL_INVALID', { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' }, JSON.stringify({ type: 'service_account', project_id: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID })],
  ])('rejects unsafe credentials with stable code %s', async (code, env, file) => {
    await expect(validateLifecycleBackfillEnvironment(
      { projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID },
      env,
      async () => file,
    )).rejects.toThrowError(code);
  });

  it('requires a readable matching service account even for dry-run and rejects every configured emulator input', async () => {
    const readFile = vi.fn(async () => validCredential());
    await expect(validateLifecycleBackfillEnvironment(
      { projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID },
      {
        GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json',
        FIRESTORE_EMULATOR_HOST: '',
        CUSTOM_EMULATOR_HOST: '',
      },
      readFile,
    )).resolves.toEqual({ keyFilename: '/explicit/key.json' });
    expect(readFile).toHaveBeenCalledWith('/explicit/key.json', 'utf8');

    for (const emulatorKey of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB', 'CUSTOM_EMULATOR_HOST']) {
      await expect(validateLifecycleBackfillEnvironment(
        { projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID },
        {
          GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json',
          [emulatorKey]: '127.0.0.1:8080',
        },
        readFile,
      )).rejects.toThrowError('EMULATOR_CONFIGURED');
    }
  });

  it('rejects unreadable and non-object credential payloads without exposing their contents', async () => {
    const env = {
      GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json',
      UNUSED_EMULATOR_HOST: undefined,
    };
    await expect(validateLifecycleBackfillEnvironment(
      { projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID },
      env,
      async () => { throw new Error('private filesystem error'); },
    )).rejects.toThrowError('CREDENTIALS_UNREADABLE');
    for (const payload of ['null', '"secret-string"']) {
      await expect(validateLifecycleBackfillEnvironment(
        { projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID },
        env,
        async () => payload,
      )).rejects.toThrowError('CREDENTIALS_NOT_SERVICE_ACCOUNT');
    }
    await expect(validateLifecycleBackfillEnvironment(
      { projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID },
      env,
      async () => JSON.stringify({
        type: 'service_account',
        project_id: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
        client_email: '',
      }),
    )).rejects.toThrowError('CREDENTIALS_CLIENT_EMAIL_INVALID');
  });
});

describe('task Firestore phase', () => {
  it('defaults to zero-write dry-run, pages by document id, and resumes without duplicates', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [
      rawTask('task_a', { status: 'running', dispatchedAt: t1 }),
      rawTask('task_b', { completedAt: t1 }),
      rawTask('task_c', { completedAt: t1 }),
      rawTask('task_d', { completedAt: t1 }),
    ]);
    const firestore = fake as unknown as Firestore;

    const first = await runTaskLifecycleBackfillPhase({
      firestore,
      mode: 'dry-run',
      pageSize: 2,
      limit: 2,
    });
    if (first.cursor === null) throw new Error('Expected task cursor');
    const second = await runTaskLifecycleBackfillPhase({
      firestore,
      mode: 'dry-run',
      pageSize: 2,
      limit: 2,
      cursor: first.cursor,
    });

    expect(first).toMatchObject({ scanned: 2, changed: 2, cursor: 'task_b', limitReached: true });
    expect(second).toMatchObject({ scanned: 2, changed: 2, cursor: 'task_d', limitReached: true });
    for (const id of ['task_a', 'task_b', 'task_c', 'task_d']) {
      expect((await fake.collection('code_tasks').doc(id).get()).get('statusChangedAt')).toBeUndefined();
    }
  });

  it('applies only minimal lifecycle updates and is idempotent', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [
      rawTask('task_active', { status: 'running', dispatchedAt: t1, prompt: 'preserve-me' }),
      rawTask('task_terminal', { dispatchStatus: { terminal: true, lastSeenAt: t1 }, error: 'preserve-me' }),
      rawTask('task_existing', { statusChangedAt: t0, completedAt: t1 }),
    ]);
    const firestore = fake as unknown as Firestore;

    const applied = await runTaskLifecycleBackfillPhase({ firestore, mode: 'apply', pageSize: 2 });
    const audit = await runTaskLifecycleBackfillPhase({ firestore, mode: 'dry-run', pageSize: 2 });

    expect(applied).toMatchObject({ scanned: 3, changed: 2, skipped: 1, invalid: 0 });
    expect(audit).toMatchObject({ scanned: 3, changed: 0, skipped: 3, invalid: 0 });
    const active = await fake.collection('code_tasks').doc('task_active').get();
    expect(active.get('statusChangedAt')).toEqual(t1);
    expect(active.get('completedAt')).toBeUndefined();
    expect(active.get('prompt')).toBe('preserve-me');
    const terminal = await fake.collection('code_tasks').doc('task_terminal').get();
    expect(terminal.get('statusChangedAt')).toEqual(t1);
    expect(terminal.get('completedAt')).toEqual(t1);
    expect(terminal.get('error')).toBe('preserve-me');
    expect(terminal.get('status')).toBe('archived');
  });

  it('re-reads inside the transaction so a concurrent canonical write wins', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('task_race', { completedAt: t1 })]);
    const concurrent = new Timestamp(1_753_602_100, 987_654_321);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    vi.spyOn(fake, 'runTransaction').mockImplementationOnce(async (callback) => {
      await fake.collection('code_tasks').doc('task_race').update({ statusChangedAt: concurrent });
      return await originalRunTransaction(callback);
    });

    const report = await runTaskLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 10,
    });

    expect(report).toMatchObject({ changed: 0, skipped: 1, cursor: 'task_race' });
    expect((await fake.collection('code_tasks').doc('task_race').get()).get('statusChangedAt'))
      .toEqual(concurrent);
  });

  it('counts a retrying transaction once and never advances counters inside its callback', async () => {
    const update = vi.fn();
    const snapshot = {
      exists: true,
      id: 'task_retry',
      data: (): Record<string, unknown> => rawTask('task_retry', { completedAt: t1 }).data,
    };
    const transaction = { get: vi.fn(async () => snapshot), update };
    const runTransaction = vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => {
      await callback(transaction);
      return await callback(transaction);
    });
    const querySnapshot = { empty: false, size: 1, docs: [snapshot] };
    const query = {
      orderBy: vi.fn().mockReturnThis(),
      startAfter: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn(async () => querySnapshot),
    };
    const firestore = {
      collection: vi.fn(() => ({ ...query, doc: vi.fn(() => ({ id: 'task_retry' })) })),
      runTransaction,
    } as unknown as Firestore;

    const report = await runTaskLifecycleBackfillPhase({ firestore, mode: 'apply', pageSize: 1, limit: 1 });

    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ scanned: 1, changed: 1, cursor: 'task_retry' });
  });

  it('does not resurrect a document deleted between scan and transaction', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('task_deleted', { completedAt: t1 })]);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    vi.spyOn(fake, 'runTransaction').mockImplementationOnce(async (callback) => {
      await fake.collection('code_tasks').doc('task_deleted').delete();
      return await originalRunTransaction(callback);
    });

    const report = await runTaskLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 10,
    });

    expect(report).toMatchObject({ scanned: 1, changed: 0, deleted: 1, cursor: 'task_deleted' });
    expect((await fake.collection('code_tasks').doc('task_deleted').get()).exists).toBe(false);
  });

  it('exposes only the last committed cursor when a later document fails', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [
      rawTask('task_a', { completedAt: t1 }),
      rawTask('task_b', { completedAt: t1 }),
      rawTask('task_c', { completedAt: t1 }),
    ]);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    let transactionNumber = 0;
    vi.spyOn(fake, 'runTransaction').mockImplementation(async (callback) => {
      transactionNumber++;
      if (transactionNumber === 2) throw new Error('private failure canary');
      return await originalRunTransaction(callback);
    });

    await expect(runTaskLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 3,
    })).rejects.toMatchObject({
      name: 'LifecycleBackfillRunError',
      code: 'TASK_TRANSACTION_FAILED',
      cursor: 'task_a',
    });
  });

  it('sanitizes scan failures and retains an explicit resume cursor', async () => {
    const firestore = {
      collection: vi.fn(() => ({
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        startAfter: vi.fn().mockReturnThis(),
        get: vi.fn(async () => { throw 'non-error private canary'; }),
      })),
    } as unknown as Firestore;

    await expect(runTaskLifecycleBackfillPhase({
      firestore,
      mode: 'dry-run',
      pageSize: 10,
      cursor: 'task_resume',
    })).rejects.toMatchObject({
      code: 'TASK_SCAN_FAILED',
      cursor: 'task_resume',
      message: 'Task scan failed',
    });
  });

  it('retains an ordinary task scan error internally while exposing only its stable code to main', async () => {
    const firestore = {
      collection: vi.fn(() => ({
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn(async () => { throw new Error('ordinary scan failure'); }),
      })),
    } as unknown as Firestore;

    await expect(runTaskLifecycleBackfillPhase({
      firestore, mode: 'dry-run', pageSize: 10,
    })).rejects.toMatchObject({ code: 'TASK_SCAN_FAILED', message: 'ordinary scan failure' });
  });

  it('normalizes a non-Error task transaction rejection without advancing the cursor', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('task_non_error', { completedAt: t1 })]);
    vi.spyOn(fake, 'runTransaction').mockRejectedValueOnce('private non-error');

    await expect(runTaskLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 10,
    })).rejects.toMatchObject({
      code: 'TASK_TRANSACTION_FAILED',
      message: 'Task transaction failed',
    });
  });
});

describe('summary planning and Firestore phase', () => {
  it('reconciles newest-attempt identity and lifecycle activity while preserving user-owned state exactly', () => {
    const labelsUpdatedAt = new Timestamp(1_753_602_050, 123_456_789);
    const tasks = [
      rawTask('task-old', {
        linearIssueId: 'INT-42',
        status: 'failed',
        createdAt: t0,
        statusChangedAt: t2,
        completedAt: t2,
      }),
      rawTask('task-new', {
        linearIssueId: 'INT-42',
        status: 'implemented',
        createdAt: t1,
        statusChangedAt: t1,
        completedAt: t1,
      }),
    ];
    const summaries: RawFirestoreDocument[] = [{
      id: 'user-1_INT-42',
      data: {
        userId: 'user-1',
        groupKey: 'INT-42',
        linearIssueId: 'INT-42',
        taskCount: 2,
        activeTaskCount: 0,
        latestTaskStatus: 'failed',
        latestTaskUpdatedAt: t2,
        agentTypesPresent: ['execution'],
        hasCompletedPlanning: false,
        hasCompletedExecution: true,
        hasCompletedExecutionAgent: true,
        hasImplementationTaskId: false,
        hasPrUrl: false,
        prNumber: null,
        latestReviewNeedsRemediation: null,
        oldestTaskCreatedAt: t0,
        mostRecentDispatchedAt: null,
        aggregateStatus: 'failed',
        hasImplementationReadyLabel: true,
        hasMergeReadyLabel: false,
        labelsUpdatedAt,
        isImportant: true,
        updatedAt: t2,
      },
    }];

    const plan = buildSummaryReconciliationPlan(tasks, summaries, t2);
    const item = plan.items.find((candidate) => candidate.docId === 'user-1_INT-42');

    expect(item?.kind).toBe('upsert');
    if (item?.kind !== 'upsert') return;
    expect(item.reason).toBe('semantic_mismatch');
    expect(item.expected).toMatchObject({
      latestTaskId: 'task-new',
      latestTaskCreatedAt: t1,
      latestTaskStatus: 'implemented',
      latestTaskUpdatedAt: t2,
      latestLifecycleTaskId: 'task-old',
      hasImplementationReadyLabel: true,
      hasMergeReadyLabel: false,
      labelsUpdatedAt,
      isImportant: true,
    });
    expect(item.expected.labelsUpdatedAt?.nanoseconds).toBe(123_456_789);
  });

  it('enumerates authoritative, all-archived, ask-only, unknown, missing, and malformed summary identities separately', () => {
    const tasks = [
      rawTask('active', { linearIssueId: 'INT-ACTIVE', status: 'running', statusChangedAt: t1 }),
      rawTask('archived', { linearIssueId: 'INT-ARCHIVED', statusChangedAt: t1, completedAt: t1 }),
      rawTask('ask', { userId: 'user-ask', linearIssueId: 'INT-ASK', agentType: 'ask_agent', statusChangedAt: t1, completedAt: t1 }),
    ];
    const summaries: RawFirestoreDocument[] = [
      {
        id: 'user-ask_INT-ASK',
        data: { userId: 'user-ask', groupKey: 'INT-ASK', aggregateStatus: 'done' },
      },
      {
        id: 'user-x_INT-UNKNOWN',
        data: { userId: 'user-x', groupKey: 'INT-UNKNOWN', aggregateStatus: 'done' },
      },
      {
        id: 'wrong-doc-id',
        data: { userId: 'user-x', groupKey: 'INT-MISMATCH', aggregateStatus: 'done' },
      },
      {
        id: 'user-y_INT-BAD-FLAG',
        data: { userId: 'user-y', groupKey: 'INT-BAD-FLAG', isImportant: 'yes' },
      },
    ];

    const plan = buildSummaryReconciliationPlan(tasks, summaries, t2);

    expect(plan).toMatchObject({
      scannedSourceTasks: 3,
      rawGroups: 3,
      authoritativeGroups: 2,
      askOnlyGroups: 1,
      scannedSummaries: 4,
      missingSummaries: 2,
      askOnlyOrphans: 1,
      unknownOrphans: 1,
      invalid: 2,
    });
    expect(plan.items.find((item) => item.docId === 'user-1_INT-ARCHIVED')).toMatchObject({
      kind: 'upsert',
      reason: 'missing',
      expected: { aggregateStatus: 'archived', taskCount: 0 },
    });
  });

  it('encodes the full observed production group totals and preserves the observed user-state counts', () => {
    const tasks: RawFirestoreDocument[] = [];
    let taskIndex = 0;
    for (let groupIndex = 0; groupIndex < 1_140; groupIndex++) {
      const size = groupIndex < 78 ? 43 : groupIndex === 78 ? 32 : 1;
      for (let member = 0; member < size; member++) {
        tasks.push(rawTask(`prod-task-${String(taskIndex++).padStart(4, '0')}`, {
          userId: 'prod-user',
          linearIssueId: `INT-${String(groupIndex).padStart(4, '0')}`,
          agentType: groupIndex < 20 ? 'ask_agent' : 'execution',
          statusChangedAt: t1,
          completedAt: t1,
        }));
      }
    }
    const summaries: RawFirestoreDocument[] = [];
    for (let groupIndex = 20; groupIndex < 1_130; groupIndex++) {
      const groupKey = `INT-${String(groupIndex).padStart(4, '0')}`;
      summaries.push({
        id: `prod-user_${groupKey}`,
        data: {
          userId: 'prod-user',
          groupKey,
          linearIssueId: groupKey,
          aggregateStatus: 'done',
          ...(groupIndex < 803 && { hasImplementationReadyLabel: true, labelsUpdatedAt: t0 }),
          ...(groupIndex < 30 && { isImportant: true }),
          updatedAt: t0,
        },
      });
    }
    for (let groupIndex = 0; groupIndex < 2; groupIndex++) {
      const groupKey = `INT-${String(groupIndex).padStart(4, '0')}`;
      summaries.push({
        id: `prod-user_${groupKey}`,
        data: { userId: 'prod-user', groupKey, linearIssueId: groupKey, aggregateStatus: 'done', updatedAt: t0 },
      });
    }

    const plan = buildSummaryReconciliationPlan(tasks, summaries, t2);

    expect(tasks).toHaveLength(4_447);
    expect(plan).toMatchObject({
      scannedSourceTasks: 4_447,
      rawGroups: 1_140,
      authoritativeGroups: 1_120,
      askOnlyGroups: 20,
      scannedSummaries: 1_112,
      missingSummaries: 10,
      askOnlyOrphans: 2,
      summariesWithLabels: 783,
      importantSummaries: 10,
      maxGroupSize: 43,
    });
  });

  it('rejects raw source and summary identity/user-state variants before hydration', () => {
    const tasks: RawFirestoreDocument[] = [
      { id: 'bad-user', data: { status: 'archived', userId: '', createdAt: t0, updatedAt: t1 } },
      { id: 'bad-linear', data: { status: 'archived', userId: 'u', linearIssueId: null, createdAt: t0, updatedAt: t1 } },
      { id: 'bad-time', data: { status: 'archived', userId: 'u', linearIssueId: 'INT-BAD', statusChangedAt: null, createdAt: t0, updatedAt: t1 } },
      rawTask('bad-agent', { userId: 'u', linearIssueId: 'INT-BAD-AGENT', agentType: 42, statusChangedAt: t1, completedAt: t1 }),
      rawTask('bad-created', { userId: 'u', linearIssueId: 'INT-BAD-CREATED', createdAt: null, statusChangedAt: t1, completedAt: t1 }),
      rawTask('bad-updated', { userId: 'u', linearIssueId: 'INT-BAD-UPDATED', updatedAt: null, statusChangedAt: t1, completedAt: t1 }),
      rawTask('standalone-valid', { userId: 'u-standalone', linearIssueId: undefined, statusChangedAt: t1, completedAt: t1 }),
    ];
    const duplicate = {
      id: 'u-standalone_standalone_standalone-valid',
      data: {
        userId: 'u-standalone',
        groupKey: 'standalone_standalone-valid',
        aggregateStatus: 'archived',
      },
    };
    const summaries: RawFirestoreDocument[] = [
      duplicate,
      duplicate,
      { id: 'u_INT-BAD-LABEL-TIME', data: {
        userId: 'u', groupKey: 'INT-BAD-LABEL-TIME', aggregateStatus: 'done', labelsUpdatedAt: null,
      } },
      { id: 'u_INT-BAD-STATUS', data: {
        userId: 'u', groupKey: 'INT-BAD-STATUS', aggregateStatus: 'mystery',
      } },
    ];

    const plan = buildSummaryReconciliationPlan(tasks, summaries, t2);

    expect(plan.rawGroups).toBe(1);
    expect(plan.authoritativeGroups).toBe(1);
    expect(plan.invalid).toBe(9);
    expect(plan.items.filter((item) => item.kind === 'invalid')).toHaveLength(9);
    expect(plan.items.find((item) => item.docId === duplicate.id && item.kind === 'upsert'))
      .toMatchObject({ kind: 'upsert', reason: 'semantic_mismatch' });
  });

  it('applies per-group summary/count deltas atomically, preserves flags, and converges to a semantic no-op', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [
      rawTask('task-source', {
        userId: 'user-summary',
        linearIssueId: 'INT-SUMMARY',
        status: 'failed',
        statusChangedAt: t1,
        completedAt: t1,
      }),
    ]);
    await fake.collection('user_group_counts').doc('user-summary').set({
      userId: 'user-summary', active: 0, needsAction: 0, done: 0, failed: 0, archived: 0,
      totalGroups: 0, updatedAt: t0,
    });
    const firestore = fake as unknown as Firestore;

    const applied = await runSummaryLifecycleBackfillPhase({
      firestore,
      mode: 'apply',
      pageSize: 1,
      now: () => new Timestamp(1_753_602_999, 456_789_123),
    });
    const storedBeforeAudit = await fake.collection('task_group_summaries').doc('user-summary_INT-SUMMARY').get();
    await storedBeforeAudit.ref.update({
      isImportant: true,
      hasImplementationReadyLabel: false,
      labelsUpdatedAt: new Timestamp(1_753_602_777, 111_222_333),
      latestTaskStatus: 'running',
    });
    const repaired = await runSummaryLifecycleBackfillPhase({
      firestore,
      mode: 'apply',
      pageSize: 1,
      now: () => new Timestamp(1_753_603_000, 987_654_321),
    });
    const audit = await runSummaryLifecycleBackfillPhase({
      firestore,
      mode: 'dry-run',
      pageSize: 1,
      now: () => new Timestamp(1_753_604_000, 1),
    });

    expect(applied).toMatchObject({ changed: 1, missingSummaries: 1, cursor: 'user-summary_INT-SUMMARY' });
    expect(repaired).toMatchObject({ changed: 1, semanticUpdates: 1 });
    expect(audit).toMatchObject({ changed: 0, semanticUpdates: 0, unchanged: 1 });
    const summary = await fake.collection('task_group_summaries').doc('user-summary_INT-SUMMARY').get();
    expect(summary.get('isImportant')).toBe(true);
    expect(summary.get('hasImplementationReadyLabel')).toBe(false);
    const labelsUpdatedAt = summary.get('labelsUpdatedAt') as Timestamp;
    expect(labelsUpdatedAt.nanoseconds).toBe(111_222_333);
    const counts = await fake.collection('user_group_counts').doc('user-summary').get();
    expect(counts.get('failed')).toBe(1);
    expect(counts.get('totalGroups')).toBe(1);
  });

  it('repairs summaries independently after a simulated task-phase failure and when zero task changes remain', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('task-independent', {
      userId: 'user-independent', linearIssueId: 'INT-INDEPENDENT', statusChangedAt: t1, completedAt: t1,
    })]);
    await fake.collection('user_group_counts').doc('user-independent').set({
      userId: 'user-independent', active: 0, needsAction: 0, done: 0, failed: 0, archived: 0,
      totalGroups: 0, updatedAt: t0,
    });
    const firestore = fake as unknown as Firestore;
    const taskAudit = await runTaskLifecycleBackfillPhase({ firestore, mode: 'dry-run', pageSize: 10 });
    expect(taskAudit.changed).toBe(0);

    const summaryRun = await runCodeTaskLifecycleBackfill({
      firestore,
      mode: 'apply',
      phase: 'summaries',
      pageSize: 10,
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      now: () => t2,
    });

    expect(summaryRun.tasks).toBeUndefined();
    expect(summaryRun.summaries).toMatchObject({ changed: 1, missingSummaries: 1 });
  });

  it('deletes only proven ask-only orphans and reports unknown or malformed orphans without touching them', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('ask-only', {
      userId: 'user-ask', linearIssueId: 'INT-ASK', agentType: 'ask_agent', statusChangedAt: t1, completedAt: t1,
    })]);
    await fake.collection('task_group_summaries').doc('user-ask_INT-ASK').set({
      userId: 'user-ask', groupKey: 'INT-ASK', linearIssueId: 'INT-ASK', aggregateStatus: 'done', updatedAt: t0,
    });
    await fake.collection('task_group_summaries').doc('user-unknown_INT-UNKNOWN').set({
      userId: 'user-unknown', groupKey: 'INT-UNKNOWN', linearIssueId: 'INT-UNKNOWN', aggregateStatus: 'done', updatedAt: t0,
    });
    await fake.collection('task_group_summaries').doc('bad-id').set({
      userId: 'user-bad', groupKey: 'INT-BAD', isImportant: 'invalid', aggregateStatus: 'done', updatedAt: t0,
    });
    await fake.collection('user_group_counts').doc('user-ask').set({
      userId: 'user-ask', active: 0, needsAction: 0, done: 1, failed: 0, archived: 0,
      totalGroups: 1, updatedAt: t0,
    });

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 2,
      now: () => t2,
    });

    expect(report).toMatchObject({ deleted: 1, askOnlyOrphans: 1, unknownOrphans: 1, invalid: 1 });
    expect((await fake.collection('task_group_summaries').doc('user-ask_INT-ASK').get()).exists).toBe(false);
    expect((await fake.collection('task_group_summaries').doc('user-unknown_INT-UNKNOWN').get()).exists).toBe(true);
    expect((await fake.collection('task_group_summaries').doc('bad-id').get()).exists).toBe(true);
    const counts = await fake.collection('user_group_counts').doc('user-ask').get();
    expect(counts.get('done')).toBe(0);
    expect(counts.get('totalGroups')).toBe(0);
  });

  it('applies a standalone all-archived shell and transactionally verifies no-op reruns', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('standalone-source', {
      userId: 'user-standalone',
      linearIssueId: undefined,
      statusChangedAt: t1,
      completedAt: t1,
    })]);
    await fake.collection('user_group_counts').doc('user-standalone').set({
      userId: 'user-standalone', active: 0, needsAction: 0, done: 0, failed: 0, archived: 0,
      totalGroups: 0, updatedAt: t0,
    });
    const firestore = fake as unknown as Firestore;

    const first = await runSummaryLifecycleBackfillPhase({ firestore, mode: 'apply', pageSize: 1 });
    const second = await runSummaryLifecycleBackfillPhase({ firestore, mode: 'apply', pageSize: 1 });

    expect(first).toMatchObject({ changed: 1, missingSummaries: 1 });
    expect(second).toMatchObject({ changed: 0, unchanged: 1 });
    const summary = await fake.collection('task_group_summaries')
      .doc('user-standalone_standalone_standalone-source').get();
    expect(summary.get('aggregateStatus')).toBe('archived');
    const counts = await fake.collection('user_group_counts').doc('user-standalone').get();
    expect(counts.get('archived')).toBe(1);
    expect(counts.get('totalGroups')).toBe(1);
  });

  it('treats a missing counts document as an audit error instead of guessing global user counts', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('missing-counts', {
      userId: 'user-missing-counts', linearIssueId: 'INT-MISSING-COUNTS',
      statusChangedAt: t1, completedAt: t1,
    })]);

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 10,
      now: () => t2,
    });

    expect(report).toMatchObject({ changed: 0, invalid: 1 });
    expect((await fake.collection('task_group_summaries').doc('user-missing-counts_INT-MISSING-COUNTS').get()).exists)
      .toBe(false);
    expect((await fake.collection('user_group_counts').doc('user-missing-counts').get()).exists).toBe(false);
  });

  it('corrects only the per-group count delta when authoritative aggregate status changes', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('status-delta', {
      userId: 'user-delta', linearIssueId: 'INT-DELTA', status: 'failed', statusChangedAt: t1, completedAt: t1,
    })]);
    await fake.collection('task_group_summaries').doc('user-delta_INT-DELTA').set({
      userId: 'user-delta', groupKey: 'INT-DELTA', linearIssueId: 'INT-DELTA',
      aggregateStatus: 'done', updatedAt: t0,
    });
    await fake.collection('user_group_counts').doc('user-delta').set({
      userId: 'user-delta', active: 0, needsAction: 0, done: 1, failed: 0, archived: 0,
      totalGroups: 1, updatedAt: t0,
    });

    const dryRun = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'dry-run',
      pageSize: 10,
      now: () => t2,
    });
    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 10,
      now: () => t2,
    });

    expect(dryRun).toMatchObject({ changed: 1, semanticUpdates: 1 });
    expect(report).toMatchObject({ changed: 1, semanticUpdates: 1 });
    const counts = await fake.collection('user_group_counts').doc('user-delta').get();
    expect(counts.get('done')).toBe(0);
    expect(counts.get('failed')).toBe(1);
    expect(counts.get('totalGroups')).toBe(1);
  });

  it.each([
    ['deleted source', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('code_tasks').doc('race-source').delete();
    }],
    ['source became ask-only', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('code_tasks').doc('race-source').update({ agentType: 'ask_agent' });
    }],
    ['source canonical became invalid', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('code_tasks').doc('race-source').update({ statusChangedAt: null });
    }],
    ['current summary became invalid', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('task_group_summaries').doc('user-race_INT-RACE').set({
        userId: 'user-race', groupKey: 'INT-RACE', aggregateStatus: 'done', isImportant: 'invalid',
      });
    }],
    ['counts became invalid', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('user_group_counts').doc('user-race').set({
        userId: 'user-race', active: 0, needsAction: 0, done: 0, failed: 0, archived: 0,
        totalGroups: -1, updatedAt: t0,
      });
    }],
    ['counts ownership became invalid', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('user_group_counts').doc('user-race').set({
        userId: 'other-user', active: 0, needsAction: 0, done: 0, failed: 0, archived: 0,
        totalGroups: 0, updatedAt: t0,
      });
    }],
  ])('replans inside the summary transaction and leaves %s untouched', async (_name, mutate) => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('race-source', {
      userId: 'user-race', linearIssueId: 'INT-RACE', status: 'failed', statusChangedAt: t1, completedAt: t1,
    })]);
    await fake.collection('user_group_counts').doc('user-race').set({
      userId: 'user-race', active: 0, needsAction: 0, done: 0, failed: 0, archived: 0,
      totalGroups: 0, updatedAt: t0,
    });
    const originalRunTransaction = fake.runTransaction.bind(fake);
    vi.spyOn(fake, 'runTransaction').mockImplementationOnce(async (callback) => {
      await mutate(fake);
      return await originalRunTransaction(callback);
    });

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 10,
      now: () => t2,
    });

    expect(report).toMatchObject({ changed: 0, invalid: 1 });
  });

  it('rejects a standalone source whose ownership changes between scan and transaction', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('standalone-race', {
      userId: 'user-standalone-race', linearIssueId: undefined, statusChangedAt: t1, completedAt: t1,
    })]);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    vi.spyOn(fake, 'runTransaction').mockImplementationOnce(async (callback) => {
      await fake.collection('code_tasks').doc('standalone-race').update({ userId: 'other-user' });
      return await originalRunTransaction(callback);
    });

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 10,
      now: () => t2,
    });

    expect(report).toMatchObject({ changed: 0, invalid: 1 });
    expect((await fake.collection('task_group_summaries')
      .doc('user-standalone-race_standalone_standalone-race').get()).exists).toBe(false);
  });

  it('does not recreate a standalone source deleted after planning', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('standalone-deleted', {
      userId: 'user-standalone-deleted', linearIssueId: undefined, statusChangedAt: t1, completedAt: t1,
    })]);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    vi.spyOn(fake, 'runTransaction').mockImplementationOnce(async (callback) => {
      await fake.collection('code_tasks').doc('standalone-deleted').delete();
      return await originalRunTransaction(callback);
    });

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 10,
      now: () => t2,
    });

    expect(report).toMatchObject({ changed: 0, invalid: 1 });
    expect((await fake.collection('task_group_summaries')
      .doc('user-standalone-deleted_standalone_standalone-deleted').get()).exists).toBe(false);
  });

  it('reports ask-only dry-run states without creating a repository write', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [
      rawTask('ask-missing', {
        userId: 'user-ask-dry', linearIssueId: 'INT-ASK-MISSING', agentType: 'ask_agent',
        statusChangedAt: t1, completedAt: t1,
      }),
      rawTask('ask-stale', {
        userId: 'user-ask-dry', linearIssueId: 'INT-ASK-STALE', agentType: 'ask_agent',
        statusChangedAt: t1, completedAt: t1,
      }),
    ]);
    await fake.collection('task_group_summaries').doc('user-ask-dry_INT-ASK-STALE').set({
      userId: 'user-ask-dry', groupKey: 'INT-ASK-STALE', aggregateStatus: 'done', updatedAt: t0,
    });

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'dry-run',
      pageSize: 1,
      now: () => t2,
    });

    expect(report).toMatchObject({ processed: 2, changed: 1, unchanged: 1, askOnlyOrphans: 1, deleted: 0 });
  });

  it.each([
    ['summary_missing', { changed: 0, unchanged: 1, invalid: 0 }],
    ['source_unknown', { changed: 0, unchanged: 0, invalid: 1 }],
  ])('handles a concurrent ask-only removal outcome %s after commit', async (outcome, expected) => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('ask-outcome', {
      userId: 'user-ask-outcome', linearIssueId: 'INT-ASK-OUTCOME', agentType: 'ask_agent',
      statusChangedAt: t1, completedAt: t1,
    })]);
    await fake.collection('task_group_summaries').doc('user-ask-outcome_INT-ASK-OUTCOME').set({
      userId: 'user-ask-outcome', groupKey: 'INT-ASK-OUTCOME', aggregateStatus: 'done', updatedAt: t0,
    });
    const removeAskOnlyOrphan = vi.fn(async () => ({ ok: true as const, value: outcome }));

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 10,
      now: () => t2,
      summaryRepository: { removeAskOnlyOrphan } as never,
    });

    expect(report).toMatchObject({ ...expected, askOnlyOrphans: 1 });
    expect(removeAskOnlyOrphan).toHaveBeenCalledTimes(1);
  });

  it('turns repository removal errors into a resumable sanitized phase failure', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('ask-error', {
      userId: 'user-ask-error', linearIssueId: 'INT-ASK-ERROR', agentType: 'ask_agent',
      statusChangedAt: t1, completedAt: t1,
    })]);
    await fake.collection('task_group_summaries').doc('user-ask-error_INT-ASK-ERROR').set({
      userId: 'user-ask-error', groupKey: 'INT-ASK-ERROR', aggregateStatus: 'done', updatedAt: t0,
    });

    await expect(runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 10,
      now: () => t2,
      summaryRepository: {
        removeAskOnlyOrphan: vi.fn(async () => ({
          ok: false as const,
          error: { code: 'FIRESTORE_ERROR' as const, message: 'private repository error' },
        })),
      } as never,
    })).rejects.toMatchObject({ code: 'SUMMARY_TRANSACTION_FAILED' });
  });

  it('keeps a durable summary cursor when a later per-group transaction fails', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [
      rawTask('cursor-a', { userId: 'u', linearIssueId: 'INT-A', statusChangedAt: t1, completedAt: t1 }),
      rawTask('cursor-b', { userId: 'u', linearIssueId: 'INT-B', statusChangedAt: t1, completedAt: t1 }),
    ]);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    let invocation = 0;
    vi.spyOn(fake, 'runTransaction').mockImplementation(async (callback) => {
      invocation++;
      if (invocation === 2) throw 'private summary failure';
      return await originalRunTransaction(callback);
    });

    await expect(runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 2,
      now: () => t2,
    })).rejects.toMatchObject({
      code: 'SUMMARY_TRANSACTION_FAILED',
      cursor: 'u_INT-A',
      message: 'Summary transaction failed',
    });
  });

  it('reports a summary scan failure without constructing partial group state', async () => {
    const firestore = {
      collection: vi.fn(() => ({
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn(async () => { throw new Error('private scan failure'); }),
      })),
    } as unknown as Firestore;

    await expect(runSummaryLifecycleBackfillPhase({
      firestore,
      mode: 'dry-run',
      pageSize: 10,
      cursor: 'group_resume',
      now: () => t2,
    })).rejects.toMatchObject({
      code: 'SUMMARY_SCAN_FAILED',
      cursor: 'group_resume',
      message: 'private scan failure',
    });
  });

  it('normalizes a non-Error summary scan rejection', async () => {
    const firestore = {
      collection: vi.fn(() => ({
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn(async () => { throw 'private non-error summary scan'; }),
      })),
    } as unknown as Firestore;

    await expect(runSummaryLifecycleBackfillPhase({
      firestore, mode: 'dry-run', pageSize: 10,
    })).rejects.toMatchObject({ code: 'SUMMARY_SCAN_FAILED', message: 'Summary scan failed' });
  });

  it('bounds and resumes summary identities by their full document id', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [
      rawTask('resume-a', { userId: 'u', linearIssueId: 'INT-A', statusChangedAt: t1, completedAt: t1 }),
      rawTask('resume-b', { userId: 'u', linearIssueId: 'INT-B', statusChangedAt: t1, completedAt: t1 }),
      rawTask('resume-c', { userId: 'u', linearIssueId: 'INT-C', statusChangedAt: t1, completedAt: t1 }),
    ]);

    const first = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'dry-run',
      pageSize: 2,
      limit: 1,
      now: () => t2,
    });
    if (first.cursor === null) throw new Error('Expected summary cursor');
    const second = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'dry-run',
      pageSize: 2,
      limit: 1,
      cursor: first.cursor,
      now: () => t2,
    });

    expect(first).toMatchObject({ processed: 1, cursor: 'u_INT-A', limitReached: true });
    expect(second).toMatchObject({ processed: 1, cursor: 'u_INT-B', limitReached: true });
  });
});

describe('CLI lifecycle and legacy delegation', () => {
  it('runs both independently resumable phases and forwards single-phase bounds only when supplied', async () => {
    const fake = createFakeFirestore();
    const firestore = fake as unknown as Firestore;
    const all = await runCodeTaskLifecycleBackfill({
      firestore,
      mode: 'dry-run',
      phase: 'all',
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      pageSize: 2,
    });
    const tasks = await runCodeTaskLifecycleBackfill({
      firestore,
      mode: 'dry-run',
      phase: 'tasks',
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      pageSize: 2,
      cursor: 'task_resume',
      limit: 1,
    });
    const summaries = await runCodeTaskLifecycleBackfill({
      firestore,
      mode: 'dry-run',
      phase: 'summaries',
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      pageSize: 2,
      cursor: 'group_resume',
      limit: 1,
      now: () => t2,
      summaryRepository: { removeAskOnlyOrphan: vi.fn() } as never,
    });

    expect(all).toMatchObject({
      phase: 'all',
      tasks: { scanned: 0 },
      summaries: { processed: 0 },
    });
    expect(tasks).toMatchObject({ phase: 'tasks', tasks: { scanned: 0, cursor: 'task_resume' } });
    expect(tasks.summaries).toBeUndefined();
    expect(summaries).toMatchObject({ phase: 'summaries', summaries: { processed: 0, cursor: 'group_resume' } });
    expect(summaries.tasks).toBeUndefined();
  });

  it('validates every gate before creating an explicit Firestore client', async () => {
    const createFirestore = vi.fn();

    await expect(executeCodeTaskLifecycleBackfillCli(
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`],
      {},
      { createFirestore },
    )).rejects.toThrowError('CREDENTIALS_REQUIRED');

    expect(createFirestore).not.toHaveBeenCalled();
  });

  it('uses dedicated project/key credentials, defaults to dry-run, and terminates exactly once in finally', async () => {
    const terminate = vi.fn(async () => undefined);
    const firestore = { terminate } as unknown as Firestore;
    const runBackfill = vi.fn(async () => ({
      mode: 'dry-run' as const,
      phase: 'all' as const,
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      tasks: { scanned: 0, changed: 0 },
      summaries: { processed: 0, changed: 0 },
    }));
    const createFirestore = vi.fn(() => firestore);

    const report = await executeCodeTaskLifecycleBackfillCli(
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`],
      { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      {
        readFile: async () => validCredential(),
        createFirestore,
        runBackfill,
      },
    );

    expect(createFirestore).toHaveBeenCalledWith({
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      keyFilename: '/explicit/key.json',
    });
    expect(runBackfill).toHaveBeenCalledWith(expect.objectContaining({ mode: 'dry-run', phase: 'all' }));
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ ok: true, mode: 'dry-run', phase: 'all' });
  });

  it('uses the production runner by default with an injected Firestore adapter', async () => {
    const fake = createFakeFirestore();
    const terminate = vi.fn(async () => undefined);
    Object.assign(fake, { terminate });

    const report = await executeCodeTaskLifecycleBackfillCli(
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'],
      { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      {
        readFile: async () => validCredential(),
        createFirestore: () => fake as unknown as Firestore,
      },
    );

    expect(report).toMatchObject({
      ok: true,
      phase: 'tasks',
      tasks: { scanned: 0, changed: 0, cursor: null },
    });
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('uses the real credential reader and dedicated Firestore constructor without contacting Firestore', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lifecycle-backfill-'));
    const keyFilename = join(directory, 'service-account.json');
    await writeFile(keyFilename, validCredential(), 'utf8');
    try {
      const report = await executeCodeTaskLifecycleBackfillCli(
        [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'],
        { GOOGLE_APPLICATION_CREDENTIALS: keyFilename },
        { runBackfill: async () => null },
      );
      expect(report).toEqual({
        ok: true,
        projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
        mode: 'dry-run',
        phase: 'tasks',
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('allowlists success fields and omits non-object or secret runner output', async () => {
    const terminate = vi.fn(async () => undefined);
    const report = await executeCodeTaskLifecycleBackfillCli(
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'],
      { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate } as unknown as Firestore),
        runBackfill: async () => ({
          tasks: {
            scanned: 1,
            sources: { completed: 1, secret_source: 'private canary' },
            invalidReasons: { status_invalid: 1, private_reason: 'private canary' },
            secretTaskField: 'private canary',
          },
          summaries: 'not-an-object',
          secret: 'private canary',
        }),
      },
    );

    expect(report).toEqual({
      ok: true,
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      mode: 'dry-run',
      phase: 'tasks',
      tasks: {
        scanned: 1,
        sources: { completed: 1 },
        invalidReasons: { status_invalid: 1 },
      },
    });
    expect(JSON.stringify(report)).not.toContain('private canary');
  });

  it('normalizes malformed nested count maps to empty allowlisted objects', async () => {
    const report = await executeCodeTaskLifecycleBackfillCli(
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'],
      { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate: vi.fn(async () => undefined) } as unknown as Firestore),
        runBackfill: async () => ({ tasks: { sources: null, invalidReasons: 'private canary' } }),
      },
    );

    expect(report).toMatchObject({ tasks: { sources: {}, invalidReasons: {} } });
    expect(JSON.stringify(report)).not.toContain('private canary');
  });

  it('terminates after runner failure, emits only allowlisted deterministic failure data, and sets nonzero exit status', async () => {
    const terminate = vi.fn(async () => undefined);
    const lines: string[] = [];
    let exitCode = 0;
    const secret = 'canary-private-secret-and-prompt';

    await runCodeTaskLifecycleBackfillMain({
      argv: [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--apply', '--phase=tasks'],
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      deps: {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate } as unknown as Firestore),
        runBackfill: async () => {
          throw new LifecycleBackfillRunError('TASK_TRANSACTION_FAILED', 'task_safe_cursor', secret);
        },
      },
      writeLine: (line) => { lines.push(line); },
      setExitCode: (code) => { exitCode = code; },
    });

    expect(terminate).toHaveBeenCalledTimes(1);
    expect(exitCode).toBe(1);
    expect(lines).toEqual([
      JSON.stringify({ ok: false, error: 'TASK_TRANSACTION_FAILED', cursor: 'task_safe_cursor' }),
    ]);
    expect(lines.join('\n')).not.toContain(secret);
    expect(lines.join('\n')).not.toContain('private_key');
  });

  it('does not let a terminate failure mask the durable cursor from the primary runner failure', async () => {
    const terminate = vi.fn(async () => { throw new Error('terminate failure'); });

    await expect(executeCodeTaskLifecycleBackfillCli(
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--apply', '--phase=tasks'],
      { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate } as unknown as Firestore),
        runBackfill: async () => {
          throw new LifecycleBackfillRunError('TASK_TRANSACTION_FAILED', 'task_durable', 'primary failure');
        },
      },
    )).rejects.toMatchObject({
      code: 'TASK_TRANSACTION_FAILED',
      cursor: 'task_durable',
    });
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('surfaces a terminate failure when the runner itself succeeded', async () => {
    const terminateFailure = new Error('terminate failure');
    await expect(executeCodeTaskLifecycleBackfillCli(
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'],
      { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      {
        readFile: async () => validCredential(),
        createFirestore: () => ({
          terminate: vi.fn(async () => { throw terminateFailure; }),
        } as unknown as Firestore),
        runBackfill: async () => ({ tasks: { scanned: 0 } }),
      },
    )).rejects.toBe(terminateFailure);
  });

  it.each([
    ['safety', async (): Promise<never> => {
      throw new Error('unused');
    }, ['--project=wrong-project'], 'PROJECT_MISMATCH'],
    ['unexpected', async (): Promise<never> => {
      throw new Error('private unexpected canary');
    }, [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'], 'UNEXPECTED_FAILURE'],
    ['run-without-cursor', async (): Promise<never> => {
      throw new LifecycleBackfillRunError('TASK_TRANSACTION_FAILED', undefined, 'private');
    }, [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'], 'TASK_TRANSACTION_FAILED'],
  ])('emits a stable %s main failure', async (_name, runBackfill, argv, expectedError) => {
    const lines: string[] = [];
    let exitCode = 0;
    await runCodeTaskLifecycleBackfillMain({
      argv,
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      deps: {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate: vi.fn(async () => undefined) } as unknown as Firestore),
        runBackfill,
      },
      writeLine: (line) => { lines.push(line); },
      setExitCode: (code) => { exitCode = code; },
    });
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({ ok: false, error: expectedError });
    expect(exitCode).toBe(1);
  });

  it('keeps the legacy summary entry point dry-run safe and delegates to the same gates', async () => {
    const runBackfill = vi.fn(async () => ({
      mode: 'dry-run' as const,
      phase: 'summaries' as const,
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      summaries: { processed: 0, changed: 0 },
    }));
    const terminate = vi.fn(async () => undefined);
    const lines: string[] = [];

    await runLegacyGroupSummaryBackfillMain({
      argv: [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`],
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      deps: {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate } as unknown as Firestore),
        runBackfill,
      },
      writeLine: (line) => { lines.push(line); },
      setExitCode: vi.fn(),
    });

    expect(runBackfill).toHaveBeenCalledWith(expect.objectContaining({ mode: 'dry-run', phase: 'summaries' }));
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);

    runBackfill.mockClear();
    await runLegacyGroupSummaryBackfillMain({
      argv: [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'],
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      deps: {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate: vi.fn(async () => undefined) } as unknown as Firestore),
        runBackfill,
      },
      writeLine: vi.fn(),
      setExitCode: vi.fn(),
    });
    expect(runBackfill).toHaveBeenCalledWith(expect.objectContaining({ phase: 'tasks' }));
  });

  it('uses the process output and exit-code adapters when main is invoked without overrides', async () => {
    const previousExitCode = process.exitCode;
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    try {
      await runCodeTaskLifecycleBackfillMain({
        argv: ['--project=wrong-project'],
        env: {},
      });
      expect(stdout).toHaveBeenCalledWith(`${JSON.stringify({ ok: false, error: 'PROJECT_MISMATCH' })}\n`);
      expect(process.exitCode).toBe(1);
    } finally {
      stdout.mockRestore();
      process.exitCode = previousExitCode;
    }
  });
});
