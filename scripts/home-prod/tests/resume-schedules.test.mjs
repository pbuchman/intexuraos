import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  buildResumeManifest,
  applyResumeManifest,
  hashResumeManifest,
} from '../resume-schedules-lib.mjs';

const cutoff = '2026-10-12T12:00:00.000Z';
const row = (path, data, version = '1:0') => ({ path, data, version });
const future = () => '2026-10-13T07:00:00.000Z';
const markerRow = (userId, runId, scheduledFor, source = 'calendar') => {
  const key = createHash('sha256')
    .update(JSON.stringify([userId, source, runId]))
    .digest('hex');
  return row(`whatsapp_notification_markers/${key}`, {
    userId,
    source,
    runId,
    runKey: key,
    marker: 'c'.repeat(64),
    scheduledFor,
    validUntil: '2026-10-12T11:00:00.000Z',
    consumedMessageId: 'inbound-existing',
    expiresAt: 1791892800,
  });
};
function snapshot() {
  return [
    row('calendar_schedules/cal', {
      status: 'active',
      cadence: {},
      nextRunAt: '2026-09-01T07:00:00.000Z',
      retryRun: { localDate: '2026-09-01' },
    }),
    row('message_digest_definitions/md_one', {
      status: 'active',
      revision: 3,
      checkpointAt: '2026-09-01T07:00:00.000Z',
      schedule: {},
      latestRun: {
        runId: 'mdr_old',
        startedAt: '2026-09-02T07:00:00.000Z',
        generationStatus: 'queued',
        processingStage: 'queued',
        deliveryStatus: 'not_sent',
      },
    }),
    row('message_digest_states/md_one', {
      revision: 2,
      checkpointAt: '2026-09-01T07:00:00.000Z',
      pendingWindow: {
        runId: 'mdr_old',
        trigger: 'scheduled',
        requestIdDigest: 'd'.repeat(64),
        windowStart: '2026-09-01T07:00:00.000Z',
        windowEnd: '2026-09-02T07:00:00.000Z',
        definitionRevision: 3,
        stateRevision: 2,
        erasureEpoch: 0,
        reservedAt: '2026-09-02T07:00:00.000Z',
      },
    }),
    row('message_digest_runs/mdr_old', {
      definitionId: 'md_one',
      recordRole: 'canonical',
      visibilityMigrationId: null,
      deliveryMode: 'whatsapp',
      windowEnd: '2026-09-02T07:00:00.000Z',
      generationStatus: 'queued',
      delivery: { status: 'not_sent' },
      lease: null,
      deliveryAuthorization: null,
    }),
    row('message_digest_dispatch_outbox/mdo_old', {
      definitionId: 'md_one',
      runId: 'mdr_old',
      status: 'pending',
      claim: null,
    }),
    row('code_tasks/task_old', { status: 'queued', createdAt: '2026-09-01T07:00:00.000Z' }),
    row('code_tasks/task_running', {
      status: 'running',
      createdAt: '2026-09-01T07:00:00.000Z',
      dispatchToken: 'worker',
    }),
    row('code_tasks/task_dispatched', {
      status: 'dispatched',
      createdAt: '2026-09-01T07:00:00.000Z',
      lastHeartbeat: '2026-10-12T11:59:00.000Z',
    }),
    row('code_task_user_leases/user_worker', {
      taskId: 'task_running',
      dispatchToken: 'worker',
      acquiredAt: '2026-09-01T07:00:00.000Z',
    }),
    row('merge_queue_watches/watch_old', {
      status: 'active',
      createdAt: '2026-09-01T07:00:00.000Z',
    }),
    row('message_digest_definitions/md_paused', { status: 'paused' }),
    row('message_digest_definitions/md_migrating', { status: 'migrating' }),
  ];
}
const build = (rows = snapshot()) =>
  buildResumeManifest({
    projectId: 'prod-test',
    cutoff,
    rows,
    nextCalendarBoundary: future,
    nextDigestBoundary: future,
  });

test('dry-run plans atomic digest checkpoint and terminal old work without writes or payload content', () => {
  const rows = snapshot();
  const before = JSON.stringify(rows);
  const manifest = build(rows);
  assert.equal(JSON.stringify(rows), before);
  const digest = manifest.operations.find((op) => op.kind === 'digest');
  assert.equal(
    digest.documents.find((doc) => doc.path === 'message_digest_definitions/md_one').patch
      .resumeCutoff,
    cutoff
  );
  assert.equal(
    manifest.operations.find((op) => op.kind === 'calendar').documents[0].patch.resumeCutoff,
    cutoff
  );
  assert.equal(
    digest.documents.find(
      (doc) => doc.path.endsWith('/md_one') && doc.path.startsWith('message_digest_states')
    ).patch.checkpointAt,
    cutoff
  );
  assert.equal(
    digest.documents.find((doc) => doc.path.includes('/mdo_old')).patch.terminalCode,
    'SKIPPED_BEFORE_RESUME'
  );
  assert.ok(!JSON.stringify(manifest).includes('task_running'));
  assert.ok(!JSON.stringify(manifest).includes('task_dispatched'));
  assert.ok(!JSON.stringify(manifest).includes('md_paused'));
  assert.ok(!JSON.stringify(manifest).includes('md_migrating'));
});

test('admits Auth0 calendar IDs as one Firestore segment while refusing traversal and oversized IDs', async () => {
  const rows = snapshot();
  rows[0].path = 'calendar_schedules/auth0|synthetic_calendar_daily_lookahead';
  const manifest = build(rows);
  const store = memoryStore(rows);
  await applyResumeManifest({ manifest, expectedHash: hashResumeManifest(manifest), store });
  assert.equal(store.documents.get(rows[0].path).data.nextRunAt, future());
  for (const id of ['', '.', '..', 'nested/document', 'x'.repeat(1501)]) {
    const invalid = build(rows);
    const operation = invalid.operations.find((op) => op.kind === 'calendar');
    operation.documents[0].path = `calendar_schedules/${id}`;
    operation.id = createHash('sha256')
      .update(
        JSON.stringify({
          projectId: invalid.projectId,
          cutoff: invalid.cutoff,
          kind: operation.kind,
          documents: operation.documents,
        })
      )
      .digest('hex');
    const rejectedStore = memoryStore(rows);
    await assert.rejects(
      applyResumeManifest({
        manifest: invalid,
        expectedHash: hashResumeManifest(invalid),
        store: rejectedStore,
      }),
      /INVALID_MANIFEST/
    );
    assert.equal(rejectedStore.writes, 0);
  }
});

test('retires only owned pre-T0 calendar markers atomically while preserving receipt and ingestion history', async () => {
  const rows = snapshot();
  const schedule = rows[0];
  schedule.path = 'calendar_schedules/auth0|synthetic_calendar_daily_lookahead';
  schedule.data.userId = 'auth0|synthetic';
  const id = schedule.path.split('/')[1];
  const old = markerRow(schedule.data.userId, `${id}_2026-10-11`, '2026-10-11T13:30:00.000Z');
  const futureMarker = markerRow(
    schedule.data.userId,
    `${id}_2026-10-13`,
    '2026-10-13T13:30:00.000Z'
  );
  const otherOwner = markerRow('other-user', `${id}_2026-10-11`, old.data.scheduledFor);
  const otherSchedule = markerRow(
    schedule.data.userId,
    `${id}_other_2026-10-11`,
    old.data.scheduledFor
  );
  const unrelatedSource = markerRow(
    schedule.data.userId,
    `${id}_2026-10-11`,
    old.data.scheduledFor,
    'digest'
  );
  const receipts = row('whatsapp_transport_receipts/receipt', {
    intentId: 'existing',
    transportConfirmation: { status: 'delivered', deliveredAt: old.data.scheduledFor },
  });
  rows.push(old, futureMarker, otherOwner, otherSchedule, unrelatedSource, receipts);
  const manifest = build(rows);
  const calendar = manifest.operations.find((op) => op.kind === 'calendar');
  assert.deepEqual(
    calendar.documents.map((doc) => doc.path),
    [schedule.path, old.path]
  );
  assert.deepEqual(calendar.documents[1].patch, { skippedBeforeResume: cutoff });
  const store = memoryStore(rows);
  await applyResumeManifest({ manifest, expectedHash: hashResumeManifest(manifest), store });
  assert.deepEqual(store.documents.get(old.path).data, {
    ...old.data,
    skippedBeforeResume: cutoff,
  });
  for (const preserved of [futureMarker, otherOwner, otherSchedule, unrelatedSource, receipts])
    assert.deepEqual(store.documents.get(preserved.path).data, preserved.data);
  const changed = memoryStore(rows);
  changed.documents.get(old.path).data.userId = 'other-user';
  await assert.rejects(
    applyResumeManifest({ manifest, expectedHash: hashResumeManifest(manifest), store: changed }),
    /RESUME_STATE_CONFLICT/
  );
  assert.deepEqual(changed.documents.get(schedule.path).data, schedule.data);
});

test('live digest leases and queued tasks bearing worker claims are preserved', () => {
  const rows = snapshot();
  rows.find((doc) => doc.path.endsWith('/mdr_old')).data.lease = {
    expiresAt: '2026-10-13T12:00:00.000Z',
  };
  rows.find((doc) => doc.path.endsWith('/task_old')).data.dispatchToken = 'claim';
  const manifest = build(rows);
  assert.ok(!manifest.operations.some((op) => op.kind === 'digest' || op.kind === 'code_task'));
  assert.equal(manifest.blocked.length, 2);
});

function memoryStore(rows = snapshot()) {
  const documents = new Map(rows.map((doc) => [doc.path, structuredClone(doc)]));
  const audits = new Set();
  let writes = 0;
  let policy;
  let policyStatus;
  return {
    documents,
    audits,
    get writes() {
      return writes;
    },
    get policyStatus() {
      return policyStatus;
    },
    async reserve(binding) {
      if (policy !== undefined && JSON.stringify(policy) !== JSON.stringify(binding))
        throw new Error('RESUME_POLICY_BINDING_CONFLICT');
      policy = binding;
      policyStatus ??= 'preparing';
    },
    async transaction(operation, callback) {
      const committed = audits.has(operation.id);
      const current = operation.documents.map((doc) => documents.get(doc.path));
      const result = callback({ committed, documents: current });
      if (result === 'applied') {
        for (const doc of operation.documents) {
          const currentDoc = documents.get(doc.path);
          for (const [field, value] of Object.entries(doc.patch)) {
            const keys = field.split('.');
            let target = currentDoc.data;
            for (const key of keys.slice(0, -1)) target = target[key];
            target[keys.at(-1)] = value;
          }
          for (const field of doc.remove ?? []) delete currentDoc.data[field];
          currentDoc.version += 'a';
          writes++;
        }
        audits.add(operation.id);
      }
      return result;
    },
    async activate() {
      writes++;
      policyStatus = 'applied';
    },
  };
}

test('apply rejects manifest tampering and expected-version conflicts before writes', async () => {
  const manifest = build();
  const store = memoryStore();
  await assert.rejects(
    applyResumeManifest({ manifest, expectedHash: '0'.repeat(64), store }),
    /HASH_MISMATCH/
  );
  assert.equal(store.writes, 0);
  store.documents.get('calendar_schedules/cal').version = 'new';
  await assert.rejects(
    applyResumeManifest({ manifest, expectedHash: hashResumeManifest(manifest), store }),
    /VERSION_CONFLICT/
  );
  assert.equal(store.writes, 0);
});

test('a failed derived summary keeps preparing and repeat apply repairs it without recancelling tasks', async () => {
  const manifest = build();
  const store = memoryStore();
  const summaryProgress = new Map();
  store.reconcileDerived = async () => {
    if (!summaryProgress.has('old-task-group')) {
      summaryProgress.set('old-task-group', 'failed');
      throw new Error('DERIVED_GROUP_RECONCILIATION_FAILED');
    }
    summaryProgress.set('old-task-group', 'applied');
  };
  await assert.rejects(
    applyResumeManifest({ manifest, expectedHash: hashResumeManifest(manifest), store }),
    /DERIVED_GROUP_RECONCILIATION_FAILED/
  );
  assert.equal(store.policyStatus, 'preparing');
  assert.equal(store.documents.get('code_tasks/task_old').data.status, 'cancelled');
  assert.equal(store.documents.get('code_tasks/task_running').data.status, 'running');
  const writes = store.writes;
  const result = await applyResumeManifest({
    manifest,
    expectedHash: hashResumeManifest(manifest),
    store,
  });
  assert.equal(result.alreadyApplied, manifest.operations.length);
  assert.equal(store.writes, writes + 1);
  assert.equal(summaryProgress.get('old-task-group'), 'applied');
  assert.equal(store.policyStatus, 'applied');
});

test('apply rejects arbitrary collections, extra patch fields and invalid versions before the first write', async () => {
  for (const modify of [
    (manifest) => {
      manifest.operations[1].documents[0].path = 'users/private';
    },
    (manifest) => {
      manifest.operations[1].documents[0].patch.prompt = 'unsafe';
    },
    (manifest) => {
      manifest.operations[1].documents[0].expectedVersion = 'invalid';
    },
    (manifest) => {
      manifest.extra = true;
    },
  ]) {
    const manifest = build();
    modify(manifest);
    for (const operation of manifest.operations)
      operation.id = createHash('sha256')
        .update(
          JSON.stringify({
            projectId: manifest.projectId,
            cutoff: manifest.cutoff,
            kind: operation.kind,
            documents: operation.documents,
          })
        )
        .digest('hex');
    const store = memoryStore();
    await assert.rejects(
      applyResumeManifest({ manifest, expectedHash: hashResumeManifest(manifest), store }),
      /INVALID_MANIFEST/
    );
    assert.equal(store.writes, 0);
  }
});

test('even a hash-valid manifest cannot cancel a running worker or claim a foreign digest run', async () => {
  const manifest = build();
  const store = memoryStore();
  store.documents.get('code_tasks/task_old').data.status = 'running';
  const original = store.transaction;
  store.transaction = async (...args) => {
    if (args[0].kind !== 'code_task') return 'existing';
    return original(...args);
  };
  await assert.rejects(
    applyResumeManifest({ manifest, expectedHash: hashResumeManifest(manifest), store }),
    /RESUME_STATE_CONFLICT/
  );
  assert.equal(store.writes, 0);
  assert.equal(store.documents.get('code_tasks/task_old').data.status, 'running');
  const foreignStore = memoryStore();
  foreignStore.documents.get('message_digest_runs/mdr_old').data.userId = 'foreign-owner';
  const foreignTransaction = foreignStore.transaction;
  foreignStore.transaction = async (...args) =>
    args[0].kind === 'digest' ? foreignTransaction(...args) : 'existing';
  await assert.rejects(
    applyResumeManifest({
      manifest,
      expectedHash: hashResumeManifest(manifest),
      store: foreignStore,
    }),
    /RESUME_STATE_CONFLICT/
  );
  assert.equal(foreignStore.writes, 0);
});

test('completed accepted and migrated silent history is preserved', () => {
  const rows = snapshot();
  const run = rows.find((doc) => doc.path.endsWith('/mdr_old'));
  run.data.generationStatus = 'completed';
  run.data.delivery.status = 'sent';
  rows.find(
    (doc) => doc.path.endsWith('/md_one') && doc.path.startsWith('message_digest_states')
  ).data.pendingWindow = null;
  const manifest = build(rows);
  assert.ok(
    !manifest.operations
      .flatMap((op) => op.documents)
      .some((doc) => doc.path.endsWith('/mdr_old') || doc.path.endsWith('/mdo_old'))
  );
  for (const changes of [
    { deliveryMode: 'silent', generationStatus: 'queued', delivery: { status: 'not_sent' } },
    {
      visibilityMigrationId: 'migration',
      generationStatus: 'queued',
      delivery: { status: 'not_sent' },
    },
    { recordRole: 'audit', generationStatus: 'queued', delivery: { status: 'not_sent' } },
  ]) {
    Object.assign(run.data, changes);
    assert.ok(
      !build(rows)
        .operations.flatMap((op) => op.documents)
        .some((doc) => doc.path.endsWith('/mdr_old') || doc.path.endsWith('/mdo_old'))
    );
  }
});

test('repeat apply resumes partial failure and never overwrites already committed documents', async () => {
  const manifest = build();
  const store = memoryStore();
  const original = store.transaction;
  let count = 0;
  store.transaction = async (...args) => {
    if (++count === 2) throw new Error('interrupted');
    return original(...args);
  };
  await assert.rejects(
    applyResumeManifest({ manifest, expectedHash: hashResumeManifest(manifest), store }),
    /interrupted/
  );
  store.transaction = original;
  const result = await applyResumeManifest({
    manifest,
    expectedHash: hashResumeManifest(manifest),
    store,
  });
  assert.equal(result.alreadyApplied, 1);
  assert.equal(store.documents.get('message_digest_states/md_one').data.checkpointAt, cutoff);
  const writes = store.writes;
  await applyResumeManifest({ manifest, expectedHash: hashResumeManifest(manifest), store });
  assert.equal(store.writes, writes + 1);
  assert.equal(store.documents.get('code_tasks/task_running').data.status, 'running');
  assert.equal(store.documents.get('code_tasks/task_dispatched').data.status, 'dispatched');
  assert.equal(
    store.documents.get('code_task_user_leases/user_worker').data.dispatchToken,
    'worker'
  );
  assert.equal(
    store.documents.get('message_digest_definitions/md_one').data.latestRun.deliveryStatus,
    'failed'
  );
  assert.equal(store.documents.get('message_digest_runs/mdr_old').data.delivery.status, 'failed');
});

test('an existing policy binding rejects another manifest or cutoff before document mutations', async () => {
  const manifest = build();
  const store = memoryStore();
  await applyResumeManifest({ manifest, expectedHash: hashResumeManifest(manifest), store });
  const writes = store.writes;
  const other = build(snapshot().filter((doc) => !doc.path.startsWith('code_tasks/')));
  await assert.rejects(
    applyResumeManifest({ manifest: other, expectedHash: hashResumeManifest(other), store }),
    /POLICY_BINDING_CONFLICT/
  );
  assert.equal(store.writes, writes);
});
