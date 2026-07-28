import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Timestamp } from '@google-cloud/firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createFakeFirestore } from '@intexuraos/infra-firestore';
import {
  EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
  LifecycleBackfillAuditError,
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

function rawCounts(
  userId: string,
  overrides: Record<string, unknown> = {},
): RawFirestoreDocument {
  return {
    id: userId,
    data: {
      userId,
      active: 0,
      needsAction: 0,
      done: 0,
      failed: 0,
      archived: 0,
      totalGroups: 0,
      updatedAt: t0,
      ...overrides,
    },
  };
}

function seedRawCounts(
  fake: ReturnType<typeof createFakeFirestore>,
  counts: readonly RawFirestoreDocument[],
): void {
  fake.seedCollection('user_group_counts', counts.map((doc) => ({ id: doc.id, data: doc.data })));
}

function monitorSummaryCollectionQueries(fake: ReturnType<typeof createFakeFirestore>): {
  count: () => number;
} {
  const originalCollection = fake.collection.bind(fake);
  let queryCount = 0;
  vi.spyOn(fake, 'collection').mockImplementation((name) => {
    const collection = originalCollection(name);
    if (name !== 'task_group_summaries') return collection;
    const originalWhere = collection.where.bind(collection);
    vi.spyOn(collection, 'where').mockImplementation((fieldPath, opStr, value) => {
      queryCount++;
      return originalWhere(fieldPath, opStr, value);
    });
    return collection;
  });
  return { count: () => queryCount };
}

async function seedPointProofFixture(fake: ReturnType<typeof createFakeFirestore>): Promise<void> {
  seedRawTasks(fake, [
    rawTask('proof-target', {
      userId: 'user-meta', linearIssueId: 'INT-STALE', status: 'failed',
      statusChangedAt: t1, completedAt: t1,
    }),
    rawTask('proof-other', {
      userId: 'user-meta', linearIssueId: 'INT-METADATA',
      statusChangedAt: t1, completedAt: t1,
    }),
  ]);
  await fake.collection('task_group_summaries').doc('user-meta_INT-STALE').set({
    userId: 'user-meta', groupKey: 'INT-STALE', aggregateStatus: 'done', updatedAt: t0,
  });
  await fake.collection('task_group_summaries').doc('user-meta_INT-METADATA').set({
    userId: 'user-meta', groupKey: 'INT-METADATA', aggregateStatus: 'done', updatedAt: t0,
  });
  seedRawCounts(fake, [rawCounts('user-meta', { done: 2, totalGroups: 2 })]);
}

function validCredential(projectId = EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID): string {
  return JSON.stringify({
    type: 'service_account',
    project_id: projectId,
    client_email: `migration@${projectId}.iam.gserviceaccount.com`,
    private_key: 'canary-private-key-that-must-never-be-reported',
  });
}

function productionApplyEnv(): Record<string, string> {
  return {
    GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json',
    INTEXURAOS_ENVIRONMENT: 'prod',
    INTEXURAOS_RUNTIME: 'prod',
    INTEXURAOS_SENTRY_DSN: 'https://public@example.invalid/1',
  };
}

function createTelemetryHarness(): {
  logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
  flush: ReturnType<typeof vi.fn>;
} {
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    flush: vi.fn(async () => undefined),
  };
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
    ['CREDENTIALS_CLIENT_EMAIL_INVALID', { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' }, JSON.stringify({
      type: 'service_account', project_id: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      client_email: '   ', private_key: 'valid-key',
    })],
    ['CREDENTIALS_PRIVATE_KEY_INVALID', { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' }, JSON.stringify({
      type: 'service_account', project_id: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      client_email: 'migration@example.com', private_key: '   ',
    })],
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
    )).resolves.toEqual({
      credentials: {
        client_email: `migration@${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}.iam.gserviceaccount.com`,
        private_key: 'canary-private-key-that-must-never-be-reported',
      },
    });
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

  it.each([
    ['PRODUCTION_ENVIRONMENT_REQUIRED', {
      INTEXURAOS_RUNTIME: 'prod',
      INTEXURAOS_SENTRY_DSN: 'https://public@example.invalid/1',
    }],
    ['PRODUCTION_ENVIRONMENT_REQUIRED', {
      INTEXURAOS_ENVIRONMENT: 'production',
      INTEXURAOS_RUNTIME: 'prod',
      INTEXURAOS_SENTRY_DSN: 'https://public@example.invalid/1',
    }],
    ['PRODUCTION_RUNTIME_REQUIRED', {
      INTEXURAOS_ENVIRONMENT: 'prod',
      INTEXURAOS_RUNTIME: 'dev',
      INTEXURAOS_SENTRY_DSN: 'https://public@example.invalid/1',
    }],
    ['PRODUCTION_SENTRY_DSN_REQUIRED', {
      INTEXURAOS_ENVIRONMENT: 'prod',
      INTEXURAOS_RUNTIME: 'prod',
      INTEXURAOS_SENTRY_DSN: '   ',
    }],
    ['PRODUCTION_SENTRY_DSN_REQUIRED', {
      INTEXURAOS_ENVIRONMENT: 'prod',
      INTEXURAOS_RUNTIME: 'prod',
    }],
  ])('fails apply closed with %s before opening Firestore', async (code, applyEnv) => {
    await expect(validateLifecycleBackfillEnvironment(
      { projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID, mode: 'apply' },
      {
        GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json',
        ...applyEnv,
      },
      async () => validCredential(),
    )).rejects.toThrowError(code);
  });

  it('allows an intentional dry-run without production telemetry and accepts apply only with exact prod telemetry', async () => {
    const readFile = vi.fn(async () => validCredential());
    const dryRun = validateLifecycleBackfillEnvironment(
      { projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID, mode: 'dry-run' },
      { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      readFile,
    );
    const apply = validateLifecycleBackfillEnvironment(
      { projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID, mode: 'apply' },
      {
        GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json',
        INTEXURAOS_ENVIRONMENT: 'prod',
        INTEXURAOS_RUNTIME: 'prod',
        INTEXURAOS_SENTRY_DSN: 'https://public@example.invalid/1',
      },
      readFile,
    );

    await expect(dryRun).resolves.toMatchObject({ credentials: expect.any(Object) });
    await expect(apply).resolves.toMatchObject({ credentials: expect.any(Object) });
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
    expect(second).toMatchObject({ scanned: 2, changed: 2, cursor: 'task_d', limitReached: false });
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

  it('stops with CURSOR_NOT_FOUND without advancing when a scanned document is concurrently deleted', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('task_deleted', { completedAt: t1 })]);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    vi.spyOn(fake, 'runTransaction').mockImplementationOnce(async (callback) => {
      await fake.collection('code_tasks').doc('task_deleted').delete();
      return await originalRunTransaction(callback);
    });

    await expect(runTaskLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 10,
    })).rejects.toMatchObject({
      name: 'LifecycleBackfillSafetyError',
      code: 'CURSOR_NOT_FOUND',
    });

    expect((await fake.collection('code_tasks').doc('task_deleted').get()).exists).toBe(false);
  });

  it.each(['task_0000', 'task_zzzz'])(
    'rejects unknown task checkpoint %s instead of treating it as an ordering boundary',
    async (cursor) => {
      const fake = createFakeFirestore();
      seedRawTasks(fake, [
        rawTask('task_a', { completedAt: t1 }),
        rawTask('task_b', { completedAt: t1 }),
      ]);

      await expect(runTaskLifecycleBackfillPhase({
        firestore: fake as unknown as Firestore,
        mode: 'dry-run',
        pageSize: 10,
        cursor,
      })).rejects.toMatchObject({
        name: 'LifecycleBackfillSafetyError',
        code: 'CURSOR_NOT_FOUND',
      });
    },
  );

  it('stops apply on an invalid task without advancing past it, then repairs it on resume', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [
      rawTask('task_a', { completedAt: t1 }),
      rawTask('task_b', { status: 'mystery' }),
      rawTask('task_c', { completedAt: t1 }),
    ]);
    const firestore = fake as unknown as Firestore;

    const first = await runTaskLifecycleBackfillPhase({
      firestore,
      mode: 'apply',
      pageSize: 10,
    });

    expect(first).toMatchObject({ scanned: 2, changed: 1, invalid: 1, cursor: 'task_a' });
    expect((await fake.collection('code_tasks').doc('task_b').get()).get('statusChangedAt')).toBeUndefined();
    expect((await fake.collection('code_tasks').doc('task_c').get()).get('statusChangedAt')).toBeUndefined();

    await fake.collection('code_tasks').doc('task_b').update({ status: 'archived' });
    if (first.cursor === null) throw new Error('Expected durable cursor before invalid task');
    const resumed = await runTaskLifecycleBackfillPhase({
      firestore,
      mode: 'apply',
      pageSize: 10,
      cursor: first.cursor,
    });

    expect(resumed).toMatchObject({ scanned: 2, changed: 2, invalid: 0, cursor: 'task_c' });
    expect((await fake.collection('code_tasks').doc('task_b').get()).get('statusChangedAt')).toEqual(t2);
    expect((await fake.collection('code_tasks').doc('task_c').get()).get('statusChangedAt')).toEqual(t1);
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
        doc: vi.fn(() => ({ get: vi.fn(async () => ({ exists: true })) })),
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

    const plan = buildSummaryReconciliationPlan(
      tasks,
      summaries,
      [rawCounts('user-1', { failed: 1, totalGroups: 1 })],
      t2,
    );
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

    const plan = buildSummaryReconciliationPlan(
      tasks,
      summaries,
      [
        rawCounts('user-1'),
        rawCounts('user-ask', { done: 1, totalGroups: 1 }),
        rawCounts('user-x', { done: 1, totalGroups: 1 }),
        rawCounts('user-y'),
      ],
      t2,
    );

    expect(plan).toMatchObject({
      scannedSourceTasks: 3,
      rawGroups: 3,
      authoritativeGroups: 2,
      askOnlyGroups: 1,
      scannedSummaries: 4,
      missingSummaries: 2,
      askOnlyOrphans: 1,
      unknownOrphans: 1,
      invalid: 4,
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

    const plan = buildSummaryReconciliationPlan(
      tasks,
      summaries,
      [rawCounts('prod-user', { done: 1_112, totalGroups: 1_112 })],
      t2,
    );

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

  it('collapses malformed source and summary state into one invalid item per canonical group', () => {
    const tasks: RawFirestoreDocument[] = [
      { id: 'bad-user', data: { status: 'archived', userId: '', createdAt: t0, updatedAt: t1 } },
      { id: 'bad-linear', data: { status: 'archived', userId: 'u', linearIssueId: null, createdAt: t0, updatedAt: t1 } },
      { id: 'bad-time', data: { status: 'archived', userId: 'u', linearIssueId: 'INT-BAD', statusChangedAt: null, createdAt: t0, updatedAt: t1 } },
      rawTask('bad-agent', { userId: 'u', linearIssueId: 'INT-BAD-AGENT', agentType: 42, statusChangedAt: t1, completedAt: t1 }),
      rawTask('bad-created', { userId: 'u', linearIssueId: 'INT-BAD-CREATED', createdAt: null, statusChangedAt: t1, completedAt: t1 }),
      rawTask('bad-updated', { userId: 'u', linearIssueId: 'INT-BAD-UPDATED', updatedAt: null, statusChangedAt: t1, completedAt: t1 }),
      rawTask('standalone-valid', { userId: 'u-standalone', linearIssueId: undefined, statusChangedAt: t1, completedAt: t1 }),
      rawTask('valid-sibling', {
        userId: 'u', linearIssueId: 'INT-BAD', statusChangedAt: t1, completedAt: t1,
      }),
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
      { id: 'u_INT-BAD', data: {
        userId: 'u', groupKey: 'INT-BAD', aggregateStatus: 'done', updatedAt: t0,
      } },
      { id: 'u_INT-MISSING-STATUS', data: {
        userId: 'u', groupKey: 'INT-MISSING-STATUS', updatedAt: t0,
      } },
    ];

    const plan = buildSummaryReconciliationPlan(
      tasks,
      summaries,
      [
        rawCounts('u', { done: 2, totalGroups: 2 }),
        rawCounts('u-standalone', { archived: 1, totalGroups: 1 }),
      ],
      t2,
    );

    expect(plan.rawGroups).toBe(5);
    expect(plan.authoritativeGroups).toBe(0);
    expect(plan.items.filter((item) => item.docId === 'u_INT-BAD')).toHaveLength(1);
    expect(plan.items.find((item) => item.docId === 'u_INT-BAD')).toMatchObject({
      kind: 'invalid', reason: 'source_task_invalid',
    });
    expect(plan.items.filter((item) => item.docId === 'u_INT-MISSING-STATUS')).toEqual([
      expect.objectContaining({ kind: 'invalid', reason: 'summary_invalid' }),
    ]);
    expect(plan.items.filter((item) => item.docId === duplicate.id)).toEqual([
      expect.objectContaining({ kind: 'invalid', reason: 'summary_invalid' }),
    ]);
  });

  it.each([
    ['missing', []],
    ['foreign identity', [rawCounts('counts-user', { userId: 'other-user' })]],
    ['negative bucket', [rawCounts('counts-user', { done: -1, totalGroups: -1 })]],
    ['unsafe integer', [rawCounts('counts-user', { done: Number.MAX_SAFE_INTEGER + 1, totalGroups: Number.MAX_SAFE_INTEGER + 1 })]],
    ['unsafe bucket sum', [rawCounts('counts-user', {
      active: Number.MAX_SAFE_INTEGER, done: Number.MAX_SAFE_INTEGER,
      totalGroups: Number.MAX_SAFE_INTEGER,
    })]],
    ['bucket sum mismatch', [rawCounts('counts-user', { done: 1, totalGroups: 2 })]],
  ])('marks a group invalid and proposes no change when counts are %s', (_name, counts) => {
    const tasks = [rawTask('counts-task', {
      userId: 'counts-user', linearIssueId: 'INT-COUNTS', status: 'failed',
      statusChangedAt: t1, completedAt: t1,
    })];

    const plan = buildSummaryReconciliationPlan(tasks, [], counts, t2);

    expect(plan.missingSummaries).toBe(0);
    expect(plan.semanticUpdates).toBe(0);
    expect(plan.items).toEqual([
      expect.objectContaining({
        kind: 'invalid',
        docId: 'counts-user_INT-COUNTS',
        reason: 'counts_invalid',
      }),
    ]);
  });

  it.each([
    [
      'already count a missing summary',
      [],
      rawCounts('distribution-user', { done: 1, totalGroups: 1 }),
    ],
    [
      'use a different bucket than the physical summary',
      [{
        id: 'distribution-user_INT-DISTRIBUTION',
        data: {
          userId: 'distribution-user', groupKey: 'INT-DISTRIBUTION',
          aggregateStatus: 'done', updatedAt: t0,
        },
      }],
      rawCounts('distribution-user', { failed: 1, totalGroups: 1 }),
    ],
  ])('rejects counts that %s even though their buckets and total are internally valid', (
    _name,
    summaries,
    counts,
  ) => {
    const plan = buildSummaryReconciliationPlan(
      [rawTask('distribution-task', {
        userId: 'distribution-user', linearIssueId: 'INT-DISTRIBUTION',
        statusChangedAt: t1, completedAt: t1,
      })],
      summaries,
      [counts],
      t2,
    );

    expect(plan.items).toEqual([
      expect.objectContaining({ kind: 'invalid', reason: 'counts_invalid' }),
    ]);
    expect(plan.missingSummaries).toBe(0);
    expect(plan.semanticUpdates).toBe(0);
  });

  it('reports internally valid nonzero counts when no physical summary exists', () => {
    const plan = buildSummaryReconciliationPlan(
      [],
      [],
      [rawCounts('orphan-counts-user', { done: 1, totalGroups: 1 })],
      t2,
    );

    expect(plan.items).toEqual([
      expect.objectContaining({
        kind: 'invalid', docId: 'orphan-counts-user', reason: 'counts_invalid',
      }),
    ]);
  });

  it('rejects a count vector whose physical aggregate bucket is absent', () => {
    const tasks = [rawTask('bucket-task', {
      userId: 'bucket-user', linearIssueId: 'INT-BUCKET', status: 'failed',
      statusChangedAt: t1, completedAt: t1,
    })];
    const summaries = [{
      id: 'bucket-user_INT-BUCKET',
      data: {
        userId: 'bucket-user', groupKey: 'INT-BUCKET', aggregateStatus: 'done', updatedAt: t0,
      },
    }];

    const plan = buildSummaryReconciliationPlan(
      tasks,
      summaries,
      [rawCounts('bucket-user', { failed: 1, totalGroups: 1 })],
      t2,
    );

    expect(plan.semanticUpdates).toBe(0);
    expect(plan.items).toEqual([
      expect.objectContaining({ kind: 'invalid', reason: 'counts_invalid' }),
    ]);
  });

  it('rejects an ask-only deletion when counts disagree with its physical summary bucket', () => {
    const tasks = [rawTask('ask-bucket-task', {
      userId: 'ask-bucket-user', linearIssueId: 'INT-ASK-BUCKET', agentType: 'ask_agent',
      statusChangedAt: t1, completedAt: t1,
    })];
    const summaries = [{
      id: 'ask-bucket-user_INT-ASK-BUCKET',
      data: {
        userId: 'ask-bucket-user', groupKey: 'INT-ASK-BUCKET',
        aggregateStatus: 'done', updatedAt: t0,
      },
    }];

    const plan = buildSummaryReconciliationPlan(
      tasks,
      summaries,
      [rawCounts('ask-bucket-user', { failed: 1, totalGroups: 1 })],
      t2,
    );

    expect(plan.items).toEqual([
      expect.objectContaining({ kind: 'invalid', reason: 'counts_invalid' }),
    ]);
  });

  it('rejects impossible nonzero counts before planning a missing-summary increment', () => {
    const plan = buildSummaryReconciliationPlan(
      [rawTask('overflow-task', {
        userId: 'overflow-user', linearIssueId: 'INT-OVERFLOW',
        statusChangedAt: t1, completedAt: t1,
      })],
      [],
      [rawCounts('overflow-user', {
        archived: Number.MAX_SAFE_INTEGER,
        totalGroups: Number.MAX_SAFE_INTEGER,
      })],
      t2,
    );

    expect(plan.items).toEqual([
      expect.objectContaining({ kind: 'invalid', reason: 'counts_invalid' }),
    ]);
  });

  it('never pairs an invalid physical current summary with an upsert for the same document', () => {
    const tasks = [rawTask('physical-summary-task', {
      userId: 'physical-user', linearIssueId: 'INT-PHYSICAL', status: 'failed',
      statusChangedAt: t1, completedAt: t1,
    })];
    const malformedAtExpectedId = [{
      id: 'physical-user_INT-PHYSICAL',
      data: { aggregateStatus: 'done', updatedAt: t0 },
    }];

    const plan = buildSummaryReconciliationPlan(
      tasks,
      malformedAtExpectedId,
      [rawCounts('physical-user', { done: 1, totalGroups: 1 })],
      t2,
    );

    expect(plan.items.filter((item) => item.docId === 'physical-user_INT-PHYSICAL')).toEqual([
      expect.objectContaining({ kind: 'invalid', reason: 'summary_invalid' }),
    ]);
    expect(plan.missingSummaries).toBe(0);
  });

  it('fails closed when an optional summary flag is present with a non-boolean value', () => {
    const plan = buildSummaryReconciliationPlan(
      [],
      [{ id: 'optional-flag-user_INT-OPTIONAL-FLAG', data: {
        userId: 'optional-flag-user',
        groupKey: 'INT-OPTIONAL-FLAG',
        aggregateStatus: 'done',
        isImportant: 'yes',
      } }],
      [rawCounts('optional-flag-user', { done: 1, totalGroups: 1 })],
      t2,
    );

    expect(plan.items.find((item) => item.docId === 'optional-flag-user_INT-OPTIONAL-FLAG'))
      .toMatchObject({ kind: 'invalid', reason: 'summary_invalid' });
  });

  it('reports an unidentifiable orphan summary and malformed orphan counts exactly once', () => {
    const plan = buildSummaryReconciliationPlan(
      [],
      [{ id: 'unidentified-summary', data: { aggregateStatus: 'done' } }],
      [
        rawCounts('valid-unused-counts'),
        rawCounts('invalid-unused-counts', { userId: 'foreign-user' }),
      ],
      t2,
    );

    expect(plan.scannedCounts).toBe(2);
    expect(plan.items).toHaveLength(2);
    expect(plan.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ docId: 'unidentified-summary', reason: 'summary_invalid' }),
      expect.objectContaining({ docId: 'invalid-unused-counts', reason: 'counts_invalid' }),
    ]));
  });

  it('converts a hydration-only source failure into one group audit item', () => {
    const base = rawTask('hostile-hydration', {
      userId: 'hostile-user', linearIssueId: 'INT-HOSTILE',
      statusChangedAt: t1, completedAt: t1,
    }).data;
    let ownKeysCalls = 0;
    const data = new Proxy(base, {
      ownKeys: (target): ArrayLike<string | symbol> => {
        ownKeysCalls++;
        if (ownKeysCalls > 2) throw new Error('private hydration canary');
        return Reflect.ownKeys(target);
      },
    });

    const plan = buildSummaryReconciliationPlan(
      [{ id: 'hostile-hydration', data }],
      [],
      [rawCounts('hostile-user')],
      t2,
    );

    expect(plan.items).toEqual([
      expect.objectContaining({ kind: 'invalid', reason: 'source_task_invalid' }),
    ]);
  });

  it('projects count deltas in work-key order so a multi-group dry-run matches apply', () => {
    const tasks = [
      rawTask('project-a', {
        userId: 'projection-user', linearIssueId: 'INT-PROJECT-A', status: 'failed',
        statusChangedAt: t1, completedAt: t1,
      }),
      rawTask('project-b', {
        userId: 'projection-user', linearIssueId: 'INT-PROJECT-B', status: 'failed',
        statusChangedAt: t1, completedAt: t1,
      }),
    ];
    const summaries = ['INT-PROJECT-A', 'INT-PROJECT-B'].map((groupKey) => ({
      id: `projection-user_${groupKey}`,
      data: { userId: 'projection-user', groupKey, aggregateStatus: 'done', updatedAt: t0 },
    }));

    const plan = buildSummaryReconciliationPlan(
      tasks,
      summaries,
      [rawCounts('projection-user', { done: 2, totalGroups: 2 })],
      t2,
    );

    expect(plan.semanticUpdates).toBe(2);
    expect(plan.invalid).toBe(0);
    expect(plan.items.filter((item) => item.kind === 'upsert')).toHaveLength(2);
  });

  it('normalizes the retained INT-985 completed planning task only in memory and corrects its count delta', async () => {
    const fake = createFakeFirestore();
    const completedAt = new Timestamp(1_773_886_013, 707_000_000);
    seedRawTasks(fake, [rawTask('task_76d13dde-c6d9-4c08-86c4-5589f1c8dcf2', {
      userId: 'legacy-user',
      linearIssueId: 'INT-985',
      agentType: 'planning',
      status: 'completed',
      completedAt,
      updatedAt: timestamp('2026-03-19T02:14:34.998Z'),
    })]);
    await fake.collection('task_group_summaries').doc('legacy-user_INT-985').set({
      userId: 'legacy-user',
      groupKey: 'INT-985',
      aggregateStatus: 'done',
      updatedAt: t0,
    });
    seedRawCounts(fake, [rawCounts('legacy-user', { done: 1, totalGroups: 1 })]);

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 10,
      now: () => t2,
    });

    expect(report).toMatchObject({ changed: 1, semanticUpdates: 1, invalid: 0 });
    const source = await fake.collection('code_tasks')
      .doc('task_76d13dde-c6d9-4c08-86c4-5589f1c8dcf2').get();
    expect(source.get('status')).toBe('completed');
    const summary = await fake.collection('task_group_summaries').doc('legacy-user_INT-985').get();
    expect(summary.data()).toMatchObject({
      latestTaskStatus: 'planned',
      hasCompletedPlanning: true,
      aggregateStatus: 'needs-action',
    });
    const counts = await fake.collection('user_group_counts').doc('legacy-user').get();
    expect(counts.data()).toMatchObject({ done: 0, needsAction: 1, totalGroups: 1 });
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

    expect(applied).toMatchObject({ changed: 1, missingSummaries: 1 });
    expect(applied.cursor).toMatch(/^group_[A-Za-z0-9_-]{43}$/u);
    expect(applied.cursor).not.toContain('user-summary');
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

  it('fails closed before every summary write when preflight finds an unknown or malformed orphan', async () => {
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
    seedRawCounts(fake, [
      rawCounts('user-ask', { done: 1, totalGroups: 1 }),
      rawCounts('user-unknown', { done: 1, totalGroups: 1 }),
      rawCounts('user-bad', { done: 1, totalGroups: 1 }),
    ]);
    const transaction = vi.spyOn(fake, 'runTransaction');

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 2,
      now: () => t2,
    });

    expect(report).toMatchObject({ changed: 0, deleted: 0, askOnlyOrphans: 1, unknownOrphans: 1, invalid: 2 });
    expect(transaction).not.toHaveBeenCalled();
    expect((await fake.collection('task_group_summaries').doc('user-ask_INT-ASK').get()).exists).toBe(true);
    expect((await fake.collection('task_group_summaries').doc('user-unknown_INT-UNKNOWN').get()).exists).toBe(true);
    expect((await fake.collection('task_group_summaries').doc('bad-id').get()).exists).toBe(true);
    const counts = await fake.collection('user_group_counts').doc('user-ask').get();
    expect(counts.get('done')).toBe(1);
    expect(counts.get('totalGroups')).toBe(1);
  });

  it('exposes a global invalid finding beyond a bounded dry-run before processing the first valid item', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [
      rawTask('global-valid', {
        userId: 'user-global', linearIssueId: 'INT-VALID', statusChangedAt: t1, completedAt: t1,
      }),
      rawTask('global-invalid', {
        userId: 'user-global', linearIssueId: 'INT-INVALID', status: 'mystery',
      }),
    ]);
    seedRawCounts(fake, [rawCounts('user-global')]);

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'dry-run',
      pageSize: 10,
      limit: 1,
      now: () => t2,
    });

    expect(report).toMatchObject({
      processed: 0,
      changed: 0,
      invalid: 1,
      unknownOrphans: 0,
      cursor: null,
      limitReached: false,
    });
  });

  it('exposes a global unknown orphan beyond a bounded dry-run before processing the first valid item', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('global-known', {
      userId: 'a', linearIssueId: 'A', statusChangedAt: t1, completedAt: t1,
    })]);
    await fake.collection('task_group_summaries').doc('z_Z').set({
      userId: 'z', groupKey: 'Z', aggregateStatus: 'done', updatedAt: t0,
    });
    seedRawCounts(fake, [
      rawCounts('a'),
      rawCounts('z', { done: 1, totalGroups: 1 }),
    ]);

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'dry-run',
      pageSize: 10,
      limit: 1,
      now: () => t2,
    });

    expect(report).toMatchObject({
      processed: 0,
      changed: 0,
      invalid: 0,
      unknownOrphans: 1,
      cursor: null,
      limitReached: false,
    });
  });

  it('reports an unknown orphan in dry-run without mutating it', async () => {
    const fake = createFakeFirestore();
    await fake.collection('task_group_summaries').doc('unknown-user_INT-UNKNOWN').set({
      userId: 'unknown-user', groupKey: 'INT-UNKNOWN', aggregateStatus: 'done', updatedAt: t0,
    });

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'dry-run', pageSize: 10, now: () => t2,
    });

    expect(report).toMatchObject({ processed: 0, unknownOrphans: 1, invalid: 1, changed: 0 });
    expect((await fake.collection('task_group_summaries').doc('unknown-user_INT-UNKNOWN').get()).exists)
      .toBe(true);
  });

  it('deletes a proven ask-only orphan when the complete preflight is clean', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('ask-clean', {
      userId: 'user-ask-clean', linearIssueId: 'INT-ASK-CLEAN', agentType: 'ask_agent',
      statusChangedAt: t1, completedAt: t1,
    })]);
    await fake.collection('task_group_summaries').doc('user-ask-clean_INT-ASK-CLEAN').set({
      userId: 'user-ask-clean', groupKey: 'INT-ASK-CLEAN', aggregateStatus: 'done', updatedAt: t0,
    });
    seedRawCounts(fake, [rawCounts('user-ask-clean', { done: 1, totalGroups: 1 })]);

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 10,
      now: () => t2,
    });

    expect(report).toMatchObject({ changed: 1, deleted: 1, invalid: 0, unknownOrphans: 0 });
    expect((await fake.collection('task_group_summaries').doc('user-ask-clean_INT-ASK-CLEAN').get()).exists)
      .toBe(false);
  });

  it('deletes an ask-only orphan with point reads and no collection-wide summary query', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [
      rawTask('ask-point-read', {
        userId: 'user-ask-perf', linearIssueId: 'INT-ASK', agentType: 'ask_agent',
        statusChangedAt: t1, completedAt: t1,
      }),
      rawTask('other-point-read', {
        userId: 'user-ask-perf', linearIssueId: 'INT-OTHER',
        statusChangedAt: t1, completedAt: t1,
      }),
    ]);
    await fake.collection('task_group_summaries').doc('user-ask-perf_INT-ASK').set({
      userId: 'user-ask-perf', groupKey: 'INT-ASK', aggregateStatus: 'done', updatedAt: t0,
    });
    await fake.collection('task_group_summaries').doc('user-ask-perf_INT-OTHER').set({
      userId: 'user-ask-perf', groupKey: 'INT-OTHER', aggregateStatus: 'done', updatedAt: t0,
    });
    seedRawCounts(fake, [rawCounts('user-ask-perf', { done: 2, totalGroups: 2 })]);
    const summaryQueries = monitorSummaryCollectionQueries(fake);

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply', pageSize: 10, limit: 1, now: () => t2,
    });

    expect(report).toMatchObject({ processed: 1, changed: 1, deleted: 1, invalid: 0 });
    expect(summaryQueries.count()).toBe(0);
  });

  it.each([
    ['deleted', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('task_group_summaries').doc('user-ask-proof_INT-ASK').delete();
      await fake.collection('user_group_counts').doc('user-ask-proof').update({ done: 0, totalGroups: 0 });
    }],
    ['status changed', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('task_group_summaries').doc('user-ask-proof_INT-ASK').update({
        aggregateStatus: 'active',
      });
      await fake.collection('user_group_counts').doc('user-ask-proof').update({ active: 1, done: 0 });
    }],
    ['fingerprint changed', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('task_group_summaries').doc('user-ask-proof_INT-ASK').update({
        isImportant: true,
      });
    }],
    ['source fingerprint changed', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('code_tasks').doc('ask-proof').update({ statusChangedAt: t2 });
    }],
  ])('stops ask-only apply without advancing when its planned target is concurrently %s', async (_name, mutate) => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('ask-proof', {
      userId: 'user-ask-proof', linearIssueId: 'INT-ASK', agentType: 'ask_agent',
      statusChangedAt: t1, completedAt: t1,
    })]);
    await fake.collection('task_group_summaries').doc('user-ask-proof_INT-ASK').set({
      userId: 'user-ask-proof', groupKey: 'INT-ASK', aggregateStatus: 'done', updatedAt: t0,
    });
    seedRawCounts(fake, [rawCounts('user-ask-proof', { done: 1, totalGroups: 1 })]);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    vi.spyOn(fake, 'runTransaction').mockImplementationOnce(async (callback) => {
      await mutate(fake);
      return await originalRunTransaction(callback);
    });

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply', pageSize: 10, now: () => t2,
    });

    expect(report).toMatchObject({ processed: 0, changed: 0, deleted: 0, invalid: 1, cursor: null });
  });

  it('reproves count totals and the deleted aggregate bucket for ask-only removal', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('ask-count-race', {
      userId: 'user-ask-count-race', linearIssueId: 'INT-ASK-COUNT-RACE', agentType: 'ask_agent',
      statusChangedAt: t1, completedAt: t1,
    })]);
    await fake.collection('task_group_summaries').doc('user-ask-count-race_INT-ASK-COUNT-RACE').set({
      userId: 'user-ask-count-race', groupKey: 'INT-ASK-COUNT-RACE',
      aggregateStatus: 'done', updatedAt: t0,
    });
    seedRawCounts(fake, [rawCounts('user-ask-count-race', { done: 1, totalGroups: 1 })]);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    vi.spyOn(fake, 'runTransaction').mockImplementationOnce(async (callback) => {
      await fake.collection('user_group_counts').doc('user-ask-count-race').set(
        rawCounts('user-ask-count-race', { failed: 1, totalGroups: 1 }).data,
      );
      return await originalRunTransaction(callback);
    });

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply', pageSize: 10, now: () => t2,
    });

    expect(report).toMatchObject({ changed: 0, deleted: 0, invalid: 1, cursor: null });
    expect((await fake.collection('task_group_summaries')
      .doc('user-ask-count-race_INT-ASK-COUNT-RACE').get()).exists).toBe(true);
    const counts = await fake.collection('user_group_counts').doc('user-ask-count-race').get();
    expect(counts.data()).toMatchObject({ done: 0, failed: 1, totalGroups: 1 });
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

  it.each(['dry-run', 'apply'] as const)(
    'treats a missing counts document as an audit error in %s instead of proposing a change',
    async (mode) => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('missing-counts', {
      userId: 'user-missing-counts', linearIssueId: 'INT-MISSING-COUNTS',
      statusChangedAt: t1, completedAt: t1,
    })]);

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode,
      pageSize: 10,
      now: () => t2,
    });

    expect(report).toMatchObject({ changed: 0, invalid: 1 });
    expect((await fake.collection('task_group_summaries').doc('user-missing-counts_INT-MISSING-COUNTS').get()).exists)
      .toBe(false);
    expect((await fake.collection('user_group_counts').doc('user-missing-counts').get()).exists).toBe(false);
    },
  );

  it.each(['dry-run', 'apply'] as const)(
    'rejects malformed scanned counts in %s before any summary/count mutation',
    async (mode) => {
      const fake = createFakeFirestore();
      seedRawTasks(fake, [rawTask('malformed-counts', {
        userId: 'user-malformed-counts', linearIssueId: 'INT-MALFORMED-COUNTS',
        status: 'failed', statusChangedAt: t1, completedAt: t1,
      })]);
      await fake.collection('task_group_summaries').doc('user-malformed-counts_INT-MALFORMED-COUNTS').set({
        userId: 'user-malformed-counts', groupKey: 'INT-MALFORMED-COUNTS',
        aggregateStatus: 'done', updatedAt: t0,
      });
      seedRawCounts(fake, [rawCounts('user-malformed-counts', { done: 0, failed: 1, totalGroups: 2 })]);
      const transaction = vi.spyOn(fake, 'runTransaction');

      const report = await runSummaryLifecycleBackfillPhase({
        firestore: fake as unknown as Firestore,
        mode,
        pageSize: 10,
        now: () => t2,
      });

      expect(report).toMatchObject({ scannedCounts: 1, changed: 0, invalid: 1 });
      expect(transaction).not.toHaveBeenCalled();
      const summary = await fake.collection('task_group_summaries')
        .doc('user-malformed-counts_INT-MALFORMED-COUNTS').get();
      expect(summary.get('aggregateStatus')).toBe('done');
      const counts = await fake.collection('user_group_counts').doc('user-malformed-counts').get();
      expect(counts.data()).toMatchObject({ done: 0, failed: 1, totalGroups: 2 });
    },
  );

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
    ['status change', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('task_group_summaries').doc('user-meta_INT-METADATA').update({
        aggregateStatus: 'active',
      });
      await fake.collection('user_group_counts').doc('user-meta').update({
        active: 1, done: 1,
      });
    }],
    ['insert', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('task_group_summaries').doc('user-meta_INT-INSERTED').set({
        userId: 'user-meta', groupKey: 'INT-INSERTED', aggregateStatus: 'active', updatedAt: t1,
      });
      await fake.collection('user_group_counts').doc('user-meta').update({
        active: 1, done: 2, totalGroups: 3,
      });
    }],
    ['delete', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('task_group_summaries').doc('user-meta_INT-METADATA').delete();
      await fake.collection('user_group_counts').doc('user-meta').update({
        done: 1, totalGroups: 1,
      });
    }],
  ])('fails closed when a correct concurrent unrelated %s changes the planned count vector', async (_name, mutate) => {
    const fake = createFakeFirestore();
    await seedPointProofFixture(fake);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    vi.spyOn(fake, 'runTransaction').mockImplementationOnce(async (callback) => {
      await mutate(fake);
      return await originalRunTransaction(callback);
    });

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 10,
      limit: 1,
      now: () => t2,
    });

    expect(report).toMatchObject({ processed: 0, changed: 0, invalid: 1, cursor: null });
    expect((await fake.collection('task_group_summaries').doc('user-meta_INT-STALE').get())
      .get('aggregateStatus')).toBe('done');
  });

  it.each([
    ['deleted', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('task_group_summaries').doc('user-meta_INT-STALE').delete();
      await fake.collection('user_group_counts').doc('user-meta').update({ done: 1, totalGroups: 1 });
    }],
    ['status changed', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('task_group_summaries').doc('user-meta_INT-STALE').update({
        aggregateStatus: 'active',
      });
      await fake.collection('user_group_counts').doc('user-meta').update({ active: 1, done: 1 });
    }],
    ['fingerprint changed', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('task_group_summaries').doc('user-meta_INT-STALE').update({
        isImportant: true,
      });
    }],
  ])('fails closed when the planned target summary is concurrently %s', async (_name, mutate) => {
    const fake = createFakeFirestore();
    await seedPointProofFixture(fake);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    vi.spyOn(fake, 'runTransaction').mockImplementationOnce(async (callback) => {
      await mutate(fake);
      return await originalRunTransaction(callback);
    });

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 10,
      limit: 1,
      now: () => t2,
    });

    expect(report).toMatchObject({ processed: 0, changed: 0, invalid: 1, cursor: null });
  });

  it('fails closed when a summary planned as missing concurrently appears with a matching count delta', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('appeared-target', {
      userId: 'user-appeared', linearIssueId: 'INT-APPEARED', status: 'failed',
      statusChangedAt: t1, completedAt: t1,
    })]);
    seedRawCounts(fake, [rawCounts('user-appeared')]);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    vi.spyOn(fake, 'runTransaction').mockImplementationOnce(async (callback) => {
      await fake.collection('task_group_summaries').doc('user-appeared_INT-APPEARED').set({
        userId: 'user-appeared', groupKey: 'INT-APPEARED', aggregateStatus: 'done', updatedAt: t1,
      });
      await fake.collection('user_group_counts').doc('user-appeared').update({
        done: 1, totalGroups: 1,
      });
      return await originalRunTransaction(callback);
    });

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply', pageSize: 10, now: () => t2,
    });

    expect(report).toMatchObject({ processed: 0, changed: 0, invalid: 1, cursor: null });
    expect((await fake.collection('task_group_summaries').doc('user-appeared_INT-APPEARED').get())
      .get('aggregateStatus')).toBe('done');
  });

  it('fails closed when live source would change the planned aggregate and count delta', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('source-effect-race', {
      userId: 'user-source-effect', linearIssueId: 'INT-SOURCE-EFFECT', status: 'failed',
      statusChangedAt: t1, completedAt: t1,
    })]);
    seedRawCounts(fake, [rawCounts('user-source-effect')]);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    vi.spyOn(fake, 'runTransaction').mockImplementationOnce(async (callback) => {
      await fake.collection('code_tasks').doc('source-effect-race').update({
        status: 'queued', statusChangedAt: t2,
      });
      return await originalRunTransaction(callback);
    });

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply', pageSize: 10, now: () => t2,
    });

    expect(report).toMatchObject({ processed: 0, changed: 0, invalid: 1, cursor: null });
    expect((await fake.collection('task_group_summaries')
      .doc('user-source-effect_INT-SOURCE-EFFECT').get()).exists).toBe(false);
    expect((await fake.collection('user_group_counts').doc('user-source-effect').get()).data())
      .toMatchObject({ active: 0, failed: 0, totalGroups: 0 });
  });

  it('accepts unrelated summary metadata during exact source proof without a wide summary query', async () => {
    const fake = createFakeFirestore();
    await seedPointProofFixture(fake);
    const summaryQueries = monitorSummaryCollectionQueries(fake);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    vi.spyOn(fake, 'runTransaction').mockImplementationOnce(async (callback) => {
      await fake.collection('task_group_summaries').doc('user-meta_INT-METADATA').update({
        isImportant: true,
      });
      return await originalRunTransaction(callback);
    });

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply', pageSize: 10, limit: 1, now: () => t2,
    });

    expect(report).toMatchObject({ processed: 1, changed: 1, invalid: 0 });
    expect(summaryQueries.count()).toBe(0);
    expect((await fake.collection('task_group_summaries').doc('user-meta_INT-METADATA').get())
      .get('isImportant')).toBe(true);
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
    ['counts bucket sum became invalid', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('user_group_counts').doc('user-race').set({
        userId: 'user-race', active: 0, needsAction: 0, done: 0, failed: 0, archived: 0,
        totalGroups: 1, updatedAt: t0,
      });
    }],
    ['counts drifted from the physical summary distribution', async (
      fake: ReturnType<typeof createFakeFirestore>,
    ): Promise<void> => {
      await fake.collection('user_group_counts').doc('user-race').set({
        userId: 'user-race', active: 0, needsAction: 0, done: 1, failed: 0, archived: 0,
        totalGroups: 1, updatedAt: t0,
      });
    }],
    ['counts were concurrently deleted', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('user_group_counts').doc('user-race').delete();
    }],
    ['counts became non-incrementable', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('user_group_counts').doc('user-race').set({
        userId: 'user-race', active: 0, needsAction: 0, done: 0, failed: 0,
        archived: Number.MAX_SAFE_INTEGER, totalGroups: Number.MAX_SAFE_INTEGER, updatedAt: t0,
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
    expect((await fake.collection('task_group_summaries').doc('user-race_INT-RACE').get()).exists)
      .toBe(_name === 'current summary became invalid');
  });

  it('reproves the current aggregate decrement bucket inside the summary transaction', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('decrement-race', {
      userId: 'user-decrement-race', linearIssueId: 'INT-DECREMENT-RACE',
      status: 'failed', statusChangedAt: t1, completedAt: t1,
    })]);
    await fake.collection('task_group_summaries').doc('user-decrement-race_INT-DECREMENT-RACE').set({
      userId: 'user-decrement-race', groupKey: 'INT-DECREMENT-RACE',
      aggregateStatus: 'done', updatedAt: t0,
    });
    seedRawCounts(fake, [rawCounts('user-decrement-race', { done: 1, totalGroups: 1 })]);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    vi.spyOn(fake, 'runTransaction').mockImplementationOnce(async (callback) => {
      await fake.collection('user_group_counts').doc('user-decrement-race').set(
        rawCounts('user-decrement-race', { failed: 1, totalGroups: 1 }).data,
      );
      return await originalRunTransaction(callback);
    });

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply', pageSize: 10, now: () => t2,
    });

    expect(report).toMatchObject({ changed: 0, invalid: 1, cursor: null });
    const summary = await fake.collection('task_group_summaries')
      .doc('user-decrement-race_INT-DECREMENT-RACE').get();
    expect(summary.get('aggregateStatus')).toBe('done');
    const counts = await fake.collection('user_group_counts').doc('user-decrement-race').get();
    expect(counts.data()).toMatchObject({ done: 0, failed: 1, totalGroups: 1 });

    await fake.collection('user_group_counts').doc('user-decrement-race').set(
      rawCounts('user-decrement-race', { done: 1, totalGroups: 1 }).data,
    );
    const resumed = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply', pageSize: 10, now: () => t2,
    });
    expect(resumed).toMatchObject({ changed: 1, invalid: 0 });
  });

  it('rejects a standalone source whose ownership changes between scan and transaction', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('standalone-race', {
      userId: 'user-standalone-race', linearIssueId: undefined, statusChangedAt: t1, completedAt: t1,
    })]);
    seedRawCounts(fake, [rawCounts('user-standalone-race')]);
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
    seedRawCounts(fake, [rawCounts('user-standalone-deleted')]);
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
    seedRawCounts(fake, [rawCounts('user-ask-dry', { done: 1, totalGroups: 1 })]);

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'dry-run',
      pageSize: 1,
      now: () => t2,
    });

    expect(report).toMatchObject({ processed: 2, changed: 1, unchanged: 1, askOnlyOrphans: 1, deleted: 0 });
  });

  it('proves ask-only-without-summary as a read-only point transaction before advancing', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('ask-missing-clean', {
      userId: 'user-ask-missing-clean', linearIssueId: 'INT-ASK-MISSING-CLEAN', agentType: 'ask_agent',
      statusChangedAt: t1, completedAt: t1,
    })]);
    seedRawCounts(fake, [rawCounts('user-ask-missing-clean')]);
    const summaryQueries = monitorSummaryCollectionQueries(fake);
    const transaction = vi.spyOn(fake, 'runTransaction');

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply', pageSize: 10, now: () => t2,
    });

    expect(report).toMatchObject({ processed: 1, changed: 0, unchanged: 1, invalid: 0 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(summaryQueries.count()).toBe(0);
    expect((await fake.collection('task_group_summaries')
      .doc('user-ask-missing-clean_INT-ASK-MISSING-CLEAN').get()).exists).toBe(false);
  });

  it.each([
    ['target appeared', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('task_group_summaries').doc('user-ask-missing_INT-ASK-MISSING').set({
        userId: 'user-ask-missing', groupKey: 'INT-ASK-MISSING', aggregateStatus: 'done', updatedAt: t1,
      });
      await fake.collection('user_group_counts').doc('user-ask-missing').update({
        done: 1, totalGroups: 1,
      });
    }],
    ['source became authoritative', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('code_tasks').doc('ask-missing-race').update({ agentType: 'execution' });
    }],
    ['source was deleted', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('code_tasks').doc('ask-missing-race').delete();
    }],
    ['count vector changed', async (fake: ReturnType<typeof createFakeFirestore>): Promise<void> => {
      await fake.collection('user_group_counts').doc('user-ask-missing').update({
        active: 1, totalGroups: 1,
      });
    }],
  ])('does not advance past ask-only-without-summary when its %s', async (_name, mutate) => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('ask-missing-race', {
      userId: 'user-ask-missing', linearIssueId: 'INT-ASK-MISSING', agentType: 'ask_agent',
      statusChangedAt: t1, completedAt: t1,
    })]);
    seedRawCounts(fake, [rawCounts('user-ask-missing')]);
    const originalRunTransaction = fake.runTransaction.bind(fake);
    vi.spyOn(fake, 'runTransaction').mockImplementationOnce(async (callback) => {
      await mutate(fake);
      return await originalRunTransaction(callback);
    });

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply', pageSize: 10, now: () => t2,
    });

    expect(report).toMatchObject({ processed: 0, changed: 0, unchanged: 0, invalid: 1, cursor: null });
  });

  it.each([
    ['summary_missing', { changed: 0, unchanged: 0, invalid: 1 }],
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
    seedRawCounts(fake, [rawCounts('user-ask-outcome', { done: 1, totalGroups: 1 })]);
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
    seedRawCounts(fake, [rawCounts('user-ask-error', { done: 1, totalGroups: 1 })]);

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
    seedRawCounts(fake, [rawCounts('u')]);
    const preview = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'dry-run',
      pageSize: 2,
      limit: 1,
      now: () => t2,
    });
    if (preview.cursor === null) throw new Error('Expected opaque summary cursor');
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
      cursor: preview.cursor,
      message: 'Summary transaction failed',
    });

    const resumed = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      pageSize: 2,
      cursor: preview.cursor,
      now: () => t2,
    });
    expect(resumed).toMatchObject({ processed: 1, changed: 1, limitReached: false });
    expect(resumed.cursor).not.toBe(preview.cursor);
    expect((await fake.collection('task_group_summaries').doc('u_INT-A').get()).exists).toBe(true);
    expect((await fake.collection('task_group_summaries').doc('u_INT-B').get()).exists).toBe(true);
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

  it.each([
    'group_0000000000000000000000000000000000000000000',
    'group_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
  ])('rejects unknown summary checkpoint %s instead of treating it as an ordering boundary', async (cursor) => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [rawTask('summary-cursor-source', {
      userId: 'cursor-user', linearIssueId: 'INT-CURSOR', statusChangedAt: t1, completedAt: t1,
    })]);
    seedRawCounts(fake, [rawCounts('cursor-user')]);

    await expect(runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'dry-run',
      pageSize: 10,
      cursor,
      now: () => t2,
    })).rejects.toMatchObject({
      name: 'LifecycleBackfillSafetyError',
      code: 'CURSOR_NOT_FOUND',
    });
  });

  it('uses stable opaque code-unit work keys and exact bounds across summary resumes', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [
      rawTask('resume-a', { userId: 'u', linearIssueId: 'INT-A', statusChangedAt: t1, completedAt: t1 }),
      rawTask('resume-b', { userId: 'u', linearIssueId: 'INT-B', statusChangedAt: t1, completedAt: t1 }),
      rawTask('resume-c', { userId: 'u', linearIssueId: 'INT-C', statusChangedAt: t1, completedAt: t1 }),
    ]);
    seedRawCounts(fake, [rawCounts('u')]);

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
    if (second.cursor === null) throw new Error('Expected second opaque summary cursor');
    const third = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'dry-run',
      pageSize: 2,
      limit: 1,
      cursor: second.cursor,
      now: () => t2,
    });
    const repeatedFirst = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'dry-run',
      pageSize: 2,
      limit: 1,
      now: () => t2,
    });

    expect(first).toMatchObject({ processed: 1, limitReached: true });
    expect(second).toMatchObject({ processed: 1, limitReached: true });
    expect(third).toMatchObject({ processed: 1, limitReached: false });
    expect(repeatedFirst.cursor).toBe(first.cursor);
    expect(new Set([first.cursor, second.cursor, third.cursor]).size).toBe(3);
  });

  it('sorts every canonical work item by deterministic code-unit order', () => {
    const tasks = [
      rawTask('order-z', { userId: 'order-user', linearIssueId: 'z', statusChangedAt: t1, completedAt: t1 }),
      rawTask('order-accent', { userId: 'order-user', linearIssueId: 'ä', statusChangedAt: t1, completedAt: t1 }),
      rawTask('order-upper', { userId: 'order-user', linearIssueId: 'Z', statusChangedAt: t1, completedAt: t1 }),
    ];
    const plan = buildSummaryReconciliationPlan(tasks, [], [rawCounts('order-user')], t2);
    const workKeys = plan.items.map((item) => item.workKey);

    expect(workKeys).toEqual([...workKeys].sort());
    expect(new Set(workKeys).size).toBe(plan.items.length);
  });

  it('emits one canonical item for an invalid sibling group and exposes it before bounded processing', async () => {
    const fake = createFakeFirestore();
    const tasks = [
      rawTask('dup-valid', {
        userId: 'dup-user', linearIssueId: 'INT-A', statusChangedAt: t1, completedAt: t1,
      }),
      rawTask('dup-invalid', {
        userId: 'dup-user', linearIssueId: 'INT-A', statusChangedAt: null, completedAt: t1,
      }),
      rawTask('next-valid', {
        userId: 'dup-user', linearIssueId: 'INT-B', statusChangedAt: t1, completedAt: t1,
      }),
    ];
    seedRawTasks(fake, tasks);
    seedRawCounts(fake, [rawCounts('dup-user')]);
    const plan = buildSummaryReconciliationPlan(tasks, [], [rawCounts('dup-user')], t2);

    const report = await runSummaryLifecycleBackfillPhase({
      firestore: fake as unknown as Firestore,
      mode: 'dry-run', pageSize: 10, limit: 1, now: () => t2,
    });

    expect(plan.items.filter((item) => item.docId === 'dup-user_INT-A')).toHaveLength(1);
    expect(plan.items.find((item) => item.docId === 'dup-user_INT-A')).toMatchObject({ kind: 'invalid' });
    expect(report).toMatchObject({
      processed: 0, invalid: 1, changed: 0, cursor: null, limitReached: false,
    });
  });
});

describe('CLI lifecycle and legacy delegation', () => {
  it('runs both independently resumable phases and forwards single-phase bounds only when supplied', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [
      rawTask('task_after', {
        userId: 'bounds-user', statusChangedAt: t1, completedAt: t1,
      }),
      rawTask('task_resume', {
        userId: 'bounds-user', statusChangedAt: t1, completedAt: t1,
      }),
    ]);
    seedRawCounts(fake, [rawCounts('bounds-user')]);
    const firestore = fake as unknown as Firestore;
    const logger = createTelemetryHarness().logger;
    const all = await runCodeTaskLifecycleBackfill({
      firestore,
      mode: 'dry-run',
      phase: 'all',
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      pageSize: 2,
    });
    const summaryPreview = await runSummaryLifecycleBackfillPhase({
      firestore,
      mode: 'dry-run',
      pageSize: 2,
      limit: 1,
      now: () => t2,
    });
    if (summaryPreview.cursor === null) throw new Error('Expected exact summary checkpoint');
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
      cursor: summaryPreview.cursor,
      limit: 1,
      now: () => t2,
      logger: logger as never,
      summaryRepository: { removeAskOnlyOrphan: vi.fn() } as never,
    });

    expect(all).toMatchObject({
      phase: 'all',
      tasks: { scanned: 2 },
      summaries: { processed: 2 },
    });
    expect(tasks).toMatchObject({ phase: 'tasks', tasks: { scanned: 0, cursor: 'task_resume' } });
    expect(tasks.summaries).toBeUndefined();
    expect(summaries).toMatchObject({ phase: 'summaries', summaries: { processed: 1 } });
    expect(summaries.summaries?.cursor).not.toBe(summaryPreview.cursor);
    expect(summaries.tasks).toBeUndefined();
  });

  it('stops an all-phase apply after task audit findings before scanning or writing summaries', async () => {
    const fake = createFakeFirestore();
    seedRawTasks(fake, [{ id: 'invalid-apply-task', data: { status: 'mystery' } }]);
    const summaryCollection = fake.collection('task_group_summaries');
    const summaryGet = vi.spyOn(summaryCollection, 'get');

    const report = await runCodeTaskLifecycleBackfill({
      firestore: fake as unknown as Firestore,
      mode: 'apply',
      phase: 'all',
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      pageSize: 10,
    });

    expect(report.tasks).toMatchObject({ invalid: 1 });
    expect(report.summaries).toBeUndefined();
    expect(summaryGet).not.toHaveBeenCalled();
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

  it('parses credentials once, passes only validated in-memory credentials, and terminates exactly once', async () => {
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
    const readFile = vi.fn(async () => validCredential());
    const logger = createTelemetryHarness().logger;

    const report = await executeCodeTaskLifecycleBackfillCli(
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`],
      { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      {
        readFile,
        createFirestore,
        runBackfill,
        logger: logger as never,
      },
    );

    expect(createFirestore).toHaveBeenCalledWith({
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      credentials: {
        client_email: `migration@${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}.iam.gserviceaccount.com`,
        private_key: 'canary-private-key-that-must-never-be-reported',
      },
    });
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(runBackfill).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'dry-run', phase: 'all', logger,
    }));
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

  it('flushes telemetry exactly once after a successful main run', async () => {
    const telemetry = createTelemetryHarness();
    const lines: string[] = [];

    await runCodeTaskLifecycleBackfillMain({
      argv: [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'],
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      deps: {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate: vi.fn(async () => undefined) } as unknown as Firestore),
        runBackfill: async () => ({ tasks: { scanned: 0, invalid: 0 } }),
      },
      telemetry: telemetry as never,
      writeLine: (line) => { lines.push(line); },
      setExitCode: vi.fn(),
    });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ ok: true, tasks: { scanned: 0, invalid: 0 } });
    expect(telemetry.logger.error).not.toHaveBeenCalled();
    expect(telemetry.logger.warn).not.toHaveBeenCalled();
    expect(telemetry.flush).toHaveBeenCalledTimes(1);
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

  it('sanitizes every scalar report field by type and safe nonnegative integer bounds', async () => {
    const secret = 'private scalar canary';
    const report = await executeCodeTaskLifecycleBackfillCli(
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=all'],
      { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate: vi.fn(async () => undefined) } as unknown as Firestore),
        runBackfill: async () => ({
          tasks: {
            scanned: { secret }, changed: -1, skipped: 0, deleted: 1.5,
            cursor: { secret }, limitReached: 'true',
            sources: { completed: Number.MAX_SAFE_INTEGER + 1, created: 0 },
            invalidReasons: { status_invalid: -1, lifecycle_unresolvable: 0 },
          },
          summaries: {
            processed: secret, changed: 0, cursor: 42, limitReached: null,
            scannedSourceTasks: 0, scannedCounts: 1,
          },
        }),
      },
    );

    expect(report).toMatchObject({
      tasks: {
        skipped: 0,
        sources: { created: 0 },
        invalidReasons: { lifecycle_unresolvable: 0 },
      },
      summaries: { changed: 0, scannedSourceTasks: 0, scannedCounts: 1 },
    });
    expect(report).not.toMatchObject({
      tasks: expect.objectContaining({ scanned: expect.anything() }),
      summaries: expect.objectContaining({ cursor: expect.anything() }),
    });
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it('terminates after runner failure, emits only allowlisted deterministic failure data, and sets nonzero exit status', async () => {
    const terminate = vi.fn(async () => undefined);
    const lines: string[] = [];
    let exitCode = 0;
    const secret = 'canary-private-secret-and-prompt';
    const telemetry = createTelemetryHarness();

    await runCodeTaskLifecycleBackfillMain({
      argv: [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--apply', '--phase=tasks'],
      env: productionApplyEnv(),
      deps: {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate } as unknown as Firestore),
        runBackfill: async () => {
          throw new LifecycleBackfillRunError('TASK_TRANSACTION_FAILED', 'task_safe_cursor', secret);
        },
      },
      telemetry: telemetry as never,
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
    expect(telemetry.logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(telemetry.logger.error.mock.calls)).toContain('TASK_TRANSACTION_FAILED');
    expect(JSON.stringify(telemetry.logger.error.mock.calls)).not.toContain(secret);
    expect(telemetry.flush).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['task finding', {
      tasks: {
        scanned: 1, changed: 0, skipped: 0, invalid: 1, deleted: 0,
        statusChangedAtAdded: 0, completedAtAdded: 0, activeCompletedAtAnomalies: 0,
        sources: {}, invalidReasons: { status_invalid: 1 },
        cursor: 'task_safe_cursor', limitReached: false,
      },
    }],
    ['summary finding', {
      summaries: {
        scannedSourceTasks: 0, scannedCounts: 1, rawGroups: 0, authoritativeGroups: 0,
        askOnlyGroups: 0, scannedSummaries: 1, processed: 1, changed: 0, unchanged: 0,
        deleted: 0, missingSummaries: 0, semanticUpdates: 0, askOnlyOrphans: 0,
        unknownOrphans: 1, invalid: 0, summariesWithLabels: 0, importantSummaries: 0,
        maxGroupSize: 0, cursor: 'summary_safe_cursor', limitReached: false,
      },
    }],
  ])('emits sanitized totals and a nonzero exit for an expected %s without Sentry noise', async (_name, finding) => {
    const telemetry = createTelemetryHarness();
    const lines: string[] = [];
    let exitCode = 0;
    const runBackfill = vi.fn(async () => ({
      mode: 'dry-run' as const,
      phase: 'all' as const,
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      ...finding,
      secret: 'private audit canary',
    }));

    await expect(executeCodeTaskLifecycleBackfillCli(
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`],
      { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate: vi.fn(async () => undefined) } as unknown as Firestore),
        runBackfill,
        logger: telemetry.logger as never,
      },
    )).rejects.toBeInstanceOf(LifecycleBackfillAuditError);

    await runCodeTaskLifecycleBackfillMain({
      argv: [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`],
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      deps: {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate: vi.fn(async () => undefined) } as unknown as Firestore),
        runBackfill,
      },
      telemetry: telemetry as never,
      writeLine: (line) => { lines.push(line); },
      setExitCode: (code) => { exitCode = code; },
    });

    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      ok: false,
      error: 'AUDIT_FINDINGS',
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      mode: 'dry-run',
      phase: 'all',
      ...finding,
    });
    expect(lines.join('\n')).not.toContain('private audit canary');
    expect(exitCode).toBe(1);
    expect(telemetry.logger.error).not.toHaveBeenCalled();
    expect(telemetry.logger.warn).not.toHaveBeenCalled();
    expect(telemetry.flush).toHaveBeenCalledTimes(1);
  });

  it('surfaces an apply-time invalid finding with its durable cursor and without technical telemetry', async () => {
    const telemetry = createTelemetryHarness();
    const lines: string[] = [];
    let exitCode = 0;

    await runCodeTaskLifecycleBackfillMain({
      argv: [
        `--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`,
        '--apply',
        '--phase=summaries',
      ],
      env: productionApplyEnv(),
      deps: {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate: vi.fn(async () => undefined) } as unknown as Firestore),
        runBackfill: async () => ({
          summaries: {
            scannedSourceTasks: 1,
            scannedCounts: 1,
            processed: 0,
            changed: 0,
            invalid: 1,
            unknownOrphans: 0,
            cursor: 'group_safe_previous_cursor',
            limitReached: false,
          },
        }),
      },
      telemetry: telemetry as never,
      writeLine: (line) => { lines.push(line); },
      setExitCode: (code) => { exitCode = code; },
    });

    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      ok: false,
      error: 'AUDIT_FINDINGS',
      mode: 'apply',
      phase: 'summaries',
      summaries: { invalid: 1, cursor: 'group_safe_previous_cursor' },
    });
    expect(exitCode).toBe(1);
    expect(telemetry.logger.error).not.toHaveBeenCalled();
    expect(telemetry.logger.warn).not.toHaveBeenCalled();
    expect(telemetry.flush).toHaveBeenCalledTimes(1);
  });

  it('re-sanitizes a hostile audit error at the main boundary before JSON serialization', async () => {
    const telemetry = createTelemetryHarness();
    const lines: string[] = [];
    let exitCode = 0;
    const secret = 'private hostile audit canary';
    const cyclic: Record<string, unknown> = { secret };
    cyclic['self'] = cyclic;

    await runCodeTaskLifecycleBackfillMain({
      argv: [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'],
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      deps: {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate: vi.fn(async () => undefined) } as unknown as Firestore),
        runBackfill: async () => {
          throw new LifecycleBackfillAuditError({
            projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
            mode: 'dry-run',
            phase: 'tasks',
            tasks: {
              invalid: 1,
              cursor: 'task_safe_cursor',
              sources: null,
              invalidReasons: secret,
              secret,
              unsafe: 1n,
            },
            secret,
            cyclic,
          });
        },
      },
      telemetry: telemetry as never,
      writeLine: (line) => { lines.push(line); },
      setExitCode: (code) => { exitCode = code; },
    });

    expect(lines).toEqual([JSON.stringify({
      projectId: EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID,
      mode: 'dry-run',
      phase: 'tasks',
      tasks: { invalid: 1, cursor: 'task_safe_cursor', sources: {}, invalidReasons: {} },
      ok: false,
      error: 'AUDIT_FINDINGS',
    })]);
    expect(lines.join('\n')).not.toContain(secret);
    expect(exitCode).toBe(1);
    expect(telemetry.logger.error).not.toHaveBeenCalled();
    expect(telemetry.flush).toHaveBeenCalledTimes(1);
  });

  it('reduces non-object and sparse hostile audit reports to allowlisted output', async () => {
    const telemetry = createTelemetryHarness();
    const lines: string[] = [];
    const hostileReports: unknown[] = [null, { tasks: { invalid: 1 } }];
    const runBackfill = async (): Promise<never> => {
      throw new LifecycleBackfillAuditError(hostileReports.shift() as never);
    };

    await runCodeTaskLifecycleBackfillMain({
      argv: [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'],
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      deps: {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate: vi.fn(async () => undefined) } as unknown as Firestore),
        runBackfill,
      },
      telemetry: telemetry as never,
      writeLine: (line) => { lines.push(line); },
      setExitCode: vi.fn(),
    });
    await runCodeTaskLifecycleBackfillMain({
      argv: [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'],
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      deps: {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate: vi.fn(async () => undefined) } as unknown as Firestore),
        runBackfill,
      },
      telemetry: telemetry as never,
      writeLine: (line) => { lines.push(line); },
      setExitCode: vi.fn(),
    });

    expect(lines).toEqual([
      JSON.stringify({ ok: false, error: 'AUDIT_FINDINGS' }),
      JSON.stringify({ tasks: { invalid: 1 }, ok: false, error: 'AUDIT_FINDINGS' }),
    ]);
    expect(telemetry.logger.error).not.toHaveBeenCalled();
    expect(telemetry.flush).toHaveBeenCalledTimes(2);
  });

  it('reports one aggregated sanitized technical failure and awaits one telemetry flush', async () => {
    const telemetry = createTelemetryHarness();
    const lines: string[] = [];
    let resolveFlush: (() => void) | undefined;
    const flushGate = new Promise<void>((resolve) => { resolveFlush = resolve; });
    telemetry.flush.mockImplementation(async () => await flushGate);
    const secret = 'private unexpected telemetry canary';

    let mainSettled = false;
    const main = runCodeTaskLifecycleBackfillMain({
      argv: [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'],
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      deps: {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate: vi.fn(async () => undefined) } as unknown as Firestore),
        runBackfill: async () => { throw new Error(secret); },
      },
      telemetry: telemetry as never,
      writeLine: (line) => { lines.push(line); },
      setExitCode: vi.fn(),
    }).then(() => { mainSettled = true; });

    await vi.waitFor(() => { expect(telemetry.flush).toHaveBeenCalledTimes(1); });
    expect(mainSettled).toBe(false);
    resolveFlush?.();
    await main;

    expect(lines).toEqual([JSON.stringify({ ok: false, error: 'UNEXPECTED_FAILURE' })]);
    expect(telemetry.logger.error).toHaveBeenCalledTimes(1);
    const telemetryPayload = JSON.stringify(telemetry.logger.error.mock.calls);
    expect(telemetryPayload).toContain('UNEXPECTED_FAILURE');
    expect(telemetryPayload).not.toContain(secret);
    expect(telemetryPayload).not.toContain('private_key');
    expect(telemetry.flush).toHaveBeenCalledTimes(1);
    expect(mainSettled).toBe(true);
  });

  it('does not let a terminate failure mask the durable cursor from the primary runner failure', async () => {
    const terminate = vi.fn(async () => { throw new Error('terminate failure'); });

    await expect(executeCodeTaskLifecycleBackfillCli(
      [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--apply', '--phase=tasks'],
      productionApplyEnv(),
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
    }, ['--project=wrong-project'], 'PROJECT_MISMATCH', 0],
    ['unexpected', async (): Promise<never> => {
      throw new Error('private unexpected canary');
    }, [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'], 'UNEXPECTED_FAILURE', 1],
    ['run-without-cursor', async (): Promise<never> => {
      throw new LifecycleBackfillRunError('TASK_TRANSACTION_FAILED', undefined, 'private');
    }, [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'], 'TASK_TRANSACTION_FAILED', 1],
    ['run-with-unknown-code', async (): Promise<never> => {
      throw new LifecycleBackfillRunError('private_untrusted_code', 'private_cursor', 'private');
    }, [`--project=${EXPECTED_LIFECYCLE_BACKFILL_PROJECT_ID}`, '--phase=tasks'], 'UNEXPECTED_FAILURE', 1],
  ])('emits a stable %s main failure', async (_name, runBackfill, argv, expectedError, telemetryCalls) => {
    const lines: string[] = [];
    let exitCode = 0;
    const telemetry = createTelemetryHarness();
    await runCodeTaskLifecycleBackfillMain({
      argv,
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/explicit/key.json' },
      deps: {
        readFile: async () => validCredential(),
        createFirestore: () => ({ terminate: vi.fn(async () => undefined) } as unknown as Firestore),
        runBackfill,
      },
      telemetry: telemetry as never,
      writeLine: (line) => { lines.push(line); },
      setExitCode: (code) => { exitCode = code; },
    });
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({ ok: false, error: expectedError });
    expect(exitCode).toBe(1);
    expect(telemetry.logger.error).toHaveBeenCalledTimes(telemetryCalls);
    expect(telemetry.logger.warn).not.toHaveBeenCalled();
    expect(telemetry.flush).toHaveBeenCalledTimes(1);
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
        env: { INTEXURAOS_SENTRY_DSN: '' },
      });
      expect(stdout).toHaveBeenCalledWith(`${JSON.stringify({ ok: false, error: 'PROJECT_MISMATCH' })}\n`);
      expect(process.exitCode).toBe(1);
    } finally {
      stdout.mockRestore();
      process.exitCode = previousExitCode;
    }
  });
});
