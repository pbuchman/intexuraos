import { createHash } from 'node:crypto';

export const RESUME_COLLECTIONS = [
  'calendar_schedules',
  'whatsapp_notification_markers',
  'message_digest_definitions',
  'message_digest_states',
  'message_digest_runs',
  'message_digest_dispatch_outbox',
  'code_tasks',
  'merge_queue_watches',
];
const SKIPPED = 'SKIPPED_BEFORE_RESUME';
const timestamp = (value) =>
  value?.toDate instanceof Function ? value.toDate().toISOString() : value;
const before = (value, cutoff) => Date.parse(timestamp(value)) < Date.parse(cutoff);
const live = (lease, cutoff) =>
  lease != null &&
  lease.releasedAt == null &&
  Date.parse(timestamp(lease.expiresAt)) > Date.parse(cutoff);
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const workerClaimPresent = (data) =>
  ['dispatchToken', 'dispatchedAt', 'lastHeartbeat', 'cancelNonce'].some(
    (field) => data[field] != null
  );

function ownedOldCalendarMarker(marker, schedule, cutoff) {
  const id = schedule.path.split('/')[1];
  const data = marker.data;
  if (
    typeof schedule.data.userId !== 'string' ||
    schedule.data.userId === '' ||
    typeof data.runId !== 'string'
  )
    return false;
  const localDate = data.runId.slice(-10);
  const key = sha([data.userId, data.source, data.runId]);
  return (
    data.source === 'calendar' &&
    data.userId === schedule.data.userId &&
    data.runId.slice(0, -11) === id &&
    data.runId.at(-11) === '_' &&
    /^\d{4}-\d{2}-\d{2}$/.test(localDate) &&
    Number.isFinite(Date.parse(`${localDate}T00:00:00.000Z`)) &&
    new Date(`${localDate}T00:00:00.000Z`).toISOString().slice(0, 10) === localDate &&
    marker.path === `whatsapp_notification_markers/${key}` &&
    data.runKey === key &&
    before(data.scheduledFor, cutoff)
  );
}

/** Pure dry-run: manifests contain identifiers, versions and safe patches, never source payloads. */
export function buildResumeManifest({
  projectId,
  cutoff,
  rows,
  nextCalendarBoundary,
  nextDigestBoundary,
}) {
  if (
    typeof projectId !== 'string' ||
    projectId.trim() === '' ||
    !Number.isFinite(Date.parse(cutoff))
  )
    throw new Error('INVALID_RESUME_INPUT');
  cutoff = new Date(cutoff).toISOString();
  const operations = [];
  const blocked = [];
  const add = (kind, documents) =>
    operations.push({ id: sha({ projectId, cutoff, kind, documents }), kind, documents });
  const patch = (row, changes, remove = []) => ({
    path: row.path,
    expectedVersion: row.version,
    patch: changes,
    remove,
  });
  for (const row of rows) {
    const [collection, id] = row.path.split('/');
    const data = row.data;
    if (collection === 'calendar_schedules' && data.status === 'active') {
      if (live(data.lease, cutoff)) {
        blocked.push({ path: row.path, reason: 'LIVE_CALENDAR_LEASE' });
        continue;
      }
      const markers = rows.filter(
        (item) =>
          item.path.startsWith('whatsapp_notification_markers/') &&
          ownedOldCalendarMarker(item, row, cutoff)
      );
      if (markers.length + 1 > 450) {
        blocked.push({ path: row.path, reason: 'CALENDAR_TRANSACTION_TOO_LARGE' });
        continue;
      }
      add('calendar', [
        patch(
          row,
          {
            nextRunAt: nextCalendarBoundary(data, cutoff),
            resumeCutoff: cutoff,
            updatedAt: cutoff,
          },
          ['lease', 'retryRun']
        ),
        ...markers.map((item) => patch(item, { skippedBeforeResume: cutoff })),
      ]);
    } else if (collection === 'message_digest_definitions' && data.status === 'active') {
      const state = rows.find((item) => item.path === `message_digest_states/${id}`);
      if (state === undefined) {
        blocked.push({ path: row.path, reason: 'MISSING_DIGEST_STATE' });
        continue;
      }
      if (state.data.checkpointAt > cutoff || data.checkpointAt > cutoff) {
        blocked.push({ path: row.path, reason: 'CHECKPOINT_AFTER_CUTOFF' });
        continue;
      }
      const runs = rows.filter(
        (item) =>
          item.path.startsWith('message_digest_runs/') &&
          item.data.definitionId === id &&
          item.data.recordRole === 'canonical' &&
          item.data.visibilityMigrationId === null &&
          before(item.data.windowEnd, cutoff) &&
          item.data.deliveryMode !== 'silent' &&
          (['queued', 'processing', 'failed'].includes(item.data.generationStatus) ||
            (item.data.generationStatus === 'completed' &&
              ['pending', 'failed', 'not_sent'].includes(item.data.delivery.status)))
      );
      const runIds = new Set(runs.map((item) => item.path.split('/')[1]));
      const outboxes = rows.filter(
        (item) =>
          item.path.startsWith('message_digest_dispatch_outbox/') &&
          item.data.definitionId === id &&
          runIds.has(item.data.runId) &&
          item.data.status !== 'terminal'
      );
      if (
        runs.some(
          (item) => live(item.data.lease, cutoff) || live(item.data.deliveryAuthorization, cutoff)
        ) ||
        outboxes.some((item) => live(item.data.claim, cutoff))
      ) {
        blocked.push({ path: row.path, reason: 'LIVE_DIGEST_LEASE' });
        continue;
      }
      if (state.data.pendingWindow != null && !before(state.data.pendingWindow.windowEnd, cutoff)) {
        blocked.push({ path: row.path, reason: 'CURRENT_PENDING_WINDOW' });
        continue;
      }
      const latest = runs.find((run) => run.path.split('/')[1] === data.latestRun?.runId);
      const documents = [
        patch(row, {
          checkpointAt: cutoff,
          resumeCutoff: cutoff,
          nextRunAt: nextDigestBoundary(data, cutoff),
          revision: data.revision + 1,
          updatedAt: cutoff,
          ...(latest === undefined
            ? {}
            : {
                'latestRun.deliveryStatus': 'failed',
                ...(latest.data.generationStatus === 'completed'
                  ? {}
                  : {
                      'latestRun.generationStatus': 'failed',
                      'latestRun.processingStage': 'failed',
                    }),
              }),
        }),
        patch(state, {
          checkpointAt: cutoff,
          pendingWindow: null,
          revision: state.data.revision + 1,
          updatedAt: cutoff,
        }),
        ...runs.map((item) =>
          patch(item, {
            ...(item.data.generationStatus === 'completed'
              ? {}
              : {
                  generationStatus: 'failed',
                  processingStage: 'failed',
                  safeFailureCode: SKIPPED,
                  completedAt: cutoff,
                }),
            lease: null,
            deliveryAuthorization: null,
            ...(item.data.delivery.status === 'sent'
              ? {}
              : {
                  'delivery.status': 'failed',
                  'delivery.failedAt': cutoff,
                  'delivery.failureCode': SKIPPED,
                  'delivery.nextCheckAt': null,
                  'delivery.missingSince': null,
                }),
            updatedAt: cutoff,
          })
        ),
        ...outboxes.map((item) =>
          patch(item, { status: 'terminal', terminalCode: SKIPPED, claim: null, updatedAt: cutoff })
        ),
      ];
      if (documents.length > 450) {
        blocked.push({ path: row.path, reason: 'DIGEST_TRANSACTION_TOO_LARGE' });
        continue;
      }
      add('digest', documents);
    } else if (
      collection === 'code_tasks' &&
      data.status === 'queued' &&
      before(data.createdAt, cutoff)
    ) {
      if (workerClaimPresent(data)) {
        blocked.push({ path: row.path, reason: 'WORKER_CLAIM_PRESENT' });
        continue;
      }
      add('code_task', [
        patch(row, {
          status: 'cancelled',
          statusChangedAt: cutoff,
          completedAt: cutoff,
          updatedAt: cutoff,
          error: { code: 'cancelled', message: SKIPPED },
        }),
      ]);
    } else if (
      collection === 'merge_queue_watches' &&
      data.status === 'active' &&
      before(data.createdAt, cutoff)
    ) {
      add('merge_watch', [patch(row, { status: 'cancelled', cancelledAt: cutoff })]);
    }
  }
  operations.sort((left, right) => left.documents[0].path.localeCompare(right.documents[0].path));
  return { schemaVersion: 1, projectId, cutoff, operations, blocked };
}

export function hashResumeManifest(manifest) {
  return sha(manifest);
}

const fields = {
  calendar_schedules: ['nextRunAt', 'resumeCutoff', 'updatedAt'],
  whatsapp_notification_markers: ['skippedBeforeResume'],
  message_digest_definitions: [
    'checkpointAt',
    'resumeCutoff',
    'nextRunAt',
    'revision',
    'updatedAt',
    'latestRun.deliveryStatus',
    'latestRun.generationStatus',
    'latestRun.processingStage',
  ],
  message_digest_states: ['checkpointAt', 'pendingWindow', 'revision', 'updatedAt'],
  message_digest_runs: [
    'generationStatus',
    'processingStage',
    'safeFailureCode',
    'completedAt',
    'lease',
    'deliveryAuthorization',
    'delivery.status',
    'delivery.failedAt',
    'delivery.failureCode',
    'delivery.nextCheckAt',
    'delivery.missingSince',
    'updatedAt',
  ],
  message_digest_dispatch_outbox: ['status', 'terminalCode', 'claim', 'updatedAt'],
  code_tasks: ['status', 'statusChangedAt', 'completedAt', 'updatedAt', 'error'],
  merge_queue_watches: ['status', 'cancelledAt'],
};
const exactKeys = (object, allowed) =>
  object !== null &&
  typeof object === 'object' &&
  !Array.isArray(object) &&
  Object.keys(object).length === allowed.length &&
  Object.keys(object).every((key) => allowed.includes(key));
function invalid() {
  throw new Error('INVALID_MANIFEST');
}
function validDocumentPath(path) {
  if (typeof path !== 'string') return false;
  const parts = path.split('/');
  return (
    parts.length === 2 &&
    /^[a-z_]+$/.test(parts[0]) &&
    parts[1] !== '' &&
    parts[1] !== '.' &&
    parts[1] !== '..' &&
    !/^__.*__$/.test(parts[1]) &&
    Buffer.byteLength(parts[1], 'utf8') <= 1500
  );
}
function validateManifest(manifest) {
  if (
    !exactKeys(manifest, ['schemaVersion', 'projectId', 'cutoff', 'operations', 'blocked']) ||
    manifest.schemaVersion !== 1 ||
    typeof manifest.projectId !== 'string' ||
    manifest.projectId.trim() === '' ||
    typeof manifest.cutoff !== 'string' ||
    !Number.isFinite(Date.parse(manifest.cutoff)) ||
    new Date(manifest.cutoff).toISOString() !== manifest.cutoff ||
    !Array.isArray(manifest.operations) ||
    !Array.isArray(manifest.blocked)
  )
    invalid();
  const paths = new Set();
  for (const operation of manifest.operations) {
    if (
      !exactKeys(operation, ['id', 'kind', 'documents']) ||
      !['calendar', 'digest', 'code_task', 'merge_watch'].includes(operation.kind) ||
      !Array.isArray(operation.documents) ||
      operation.documents.length < 1 ||
      operation.documents.length > 450 ||
      operation.id !==
        sha({
          projectId: manifest.projectId,
          cutoff: manifest.cutoff,
          kind: operation.kind,
          documents: operation.documents,
        })
    )
      invalid();
    for (const document of operation.documents) {
      if (
        !exactKeys(document, ['path', 'expectedVersion', 'patch', 'remove']) ||
        !validDocumentPath(document.path) ||
        typeof document.expectedVersion !== 'string' ||
        !/^\d+:\d{1,9}$/.test(document.expectedVersion) ||
        paths.has(document.path)
      )
        invalid();
      paths.add(document.path);
      const collection = document.path.split('/')[0];
      const allowed = fields[collection];
      const kindCollections = {
        calendar: ['calendar_schedules', 'whatsapp_notification_markers'],
        digest: [
          'message_digest_definitions',
          'message_digest_states',
          'message_digest_runs',
          'message_digest_dispatch_outbox',
        ],
        code_task: ['code_tasks'],
        merge_watch: ['merge_queue_watches'],
      };
      if (
        allowed === undefined ||
        !kindCollections[operation.kind].includes(collection) ||
        document.patch === null ||
        typeof document.patch !== 'object' ||
        Array.isArray(document.patch) ||
        Object.keys(document.patch).some((key) => !allowed.includes(key)) ||
        !Array.isArray(document.remove) ||
        document.remove.some(
          (key) => collection !== 'calendar_schedules' || !['lease', 'retryRun'].includes(key)
        )
      )
        invalid();
      const patch = document.patch;
      if (
        collection === 'whatsapp_notification_markers' &&
        patch.skippedBeforeResume !== manifest.cutoff
      )
        invalid();
      for (const [field, value] of Object.entries(patch)) {
        if (field.startsWith('latestRun.') && value !== 'failed') invalid();
        if (
          field.endsWith('At') &&
          value !== null &&
          (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
        )
          invalid();
        if (field === 'revision' && (!Number.isSafeInteger(value) || value < 1)) invalid();
        if (
          [
            'lease',
            'deliveryAuthorization',
            'claim',
            'pendingWindow',
            'delivery.nextCheckAt',
            'delivery.missingSince',
          ].includes(field) &&
          value !== null
        )
          invalid();
        if (
          ['safeFailureCode', 'delivery.failureCode', 'terminalCode'].includes(field) &&
          value !== SKIPPED
        )
          invalid();
      }
      if (
        collection === 'calendar_schedules' &&
        (patch.nextRunAt <= manifest.cutoff ||
          patch.resumeCutoff !== manifest.cutoff ||
          patch.updatedAt !== manifest.cutoff)
      )
        invalid();
      if (
        collection === 'message_digest_definitions' &&
        (patch.checkpointAt !== manifest.cutoff ||
          patch.resumeCutoff !== manifest.cutoff ||
          patch.nextRunAt <= manifest.cutoff ||
          patch.updatedAt !== manifest.cutoff)
      )
        invalid();
      if (
        collection === 'message_digest_states' &&
        (patch.checkpointAt !== manifest.cutoff ||
          patch.pendingWindow !== null ||
          patch.updatedAt !== manifest.cutoff)
      )
        invalid();
      if (
        collection === 'message_digest_dispatch_outbox' &&
        (patch.status !== 'terminal' || patch.terminalCode !== SKIPPED)
      )
        invalid();
      if (
        collection === 'message_digest_runs' &&
        ((patch.generationStatus !== undefined &&
          (patch.generationStatus !== 'failed' ||
            patch.processingStage !== 'failed' ||
            patch.safeFailureCode !== SKIPPED)) ||
          patch['delivery.status'] !== 'failed' ||
          patch['delivery.failureCode'] !== SKIPPED)
      )
        invalid();
      if (
        collection === 'code_tasks' &&
        (patch.status !== 'cancelled' ||
          !exactKeys(patch.error, ['code', 'message']) ||
          patch.error.code !== 'cancelled' ||
          patch.error.message !== SKIPPED ||
          patch.statusChangedAt !== manifest.cutoff)
      )
        invalid();
      if (
        collection === 'merge_queue_watches' &&
        (patch.status !== 'cancelled' || patch.cancelledAt !== manifest.cutoff)
      )
        invalid();
    }
    if (operation.kind === 'digest') {
      const definitions = operation.documents.filter((doc) =>
        doc.path.startsWith('message_digest_definitions/')
      );
      const states = operation.documents.filter((doc) =>
        doc.path.startsWith('message_digest_states/')
      );
      if (
        definitions.length !== 1 ||
        states.length !== 1 ||
        definitions[0].path.split('/')[1] !== states[0].path.split('/')[1]
      )
        invalid();
    } else if (operation.kind === 'calendar') {
      if (
        operation.documents.filter((doc) => doc.path.startsWith('calendar_schedules/')).length !==
          1 ||
        operation.documents.length > 450
      )
        invalid();
    } else if (operation.documents.length !== 1) invalid();
  }
  for (const item of manifest.blocked)
    if (
      !exactKeys(item, ['path', 'reason']) ||
      typeof item.path !== 'string' ||
      typeof item.reason !== 'string'
    )
      invalid();
}

function validateOperationDocuments(operation, documents, cutoff) {
  const definition = documents.find((row) => row.path.startsWith('message_digest_definitions/'));
  const calendar = documents.find((row) => row.path.startsWith('calendar_schedules/'));
  const runIds = new Set(
    documents
      .filter((row) => row.path.startsWith('message_digest_runs/'))
      .map((row) => row.path.split('/')[1])
  );
  for (const row of documents) {
    const [collection, id] = row.path.split('/');
    const data = row.data;
    if (data === undefined) throw new Error('EXPECTED_VERSION_CONFLICT');
    if (
      collection === 'whatsapp_notification_markers' &&
      (calendar === undefined || !ownedOldCalendarMarker(row, calendar, cutoff))
    )
      throw new Error('RESUME_STATE_CONFLICT');
    if (
      collection === 'message_digest_definitions' &&
      operation.documents.find((doc) => doc.path === row.path).patch['latestRun.deliveryStatus'] !==
        undefined &&
      !runIds.has(data.latestRun?.runId)
    )
      throw new Error('RESUME_STATE_CONFLICT');
    if (
      collection === 'calendar_schedules' &&
      (data.status !== 'active' || live(data.lease, cutoff))
    )
      throw new Error('RESUME_STATE_CONFLICT');
    if (
      collection === 'code_tasks' &&
      (data.status !== 'queued' || !before(data.createdAt, cutoff) || workerClaimPresent(data))
    )
      throw new Error('RESUME_STATE_CONFLICT');
    if (
      collection === 'merge_queue_watches' &&
      (data.status !== 'active' || !before(data.createdAt, cutoff))
    )
      throw new Error('RESUME_STATE_CONFLICT');
    if (
      collection === 'message_digest_definitions' &&
      (data.status !== 'active' || data.checkpointAt > cutoff)
    )
      throw new Error('RESUME_STATE_CONFLICT');
    if (
      collection === 'message_digest_states' &&
      (id !== definition.path.split('/')[1] ||
        data.userId !== definition.data.userId ||
        data.checkpointAt > cutoff ||
        (data.pendingWindow != null && !before(data.pendingWindow.windowEnd, cutoff)))
    )
      throw new Error('RESUME_STATE_CONFLICT');
    if (
      collection === 'message_digest_runs' &&
      (data.definitionId !== definition.path.split('/')[1] ||
        data.userId !== definition.data.userId ||
        data.recordRole !== 'canonical' ||
        data.visibilityMigrationId !== null ||
        data.deliveryMode === 'silent' ||
        !before(data.windowEnd, cutoff) ||
        !['queued', 'processing', 'failed', 'completed'].includes(data.generationStatus) ||
        !['pending', 'not_sent', 'failed'].includes(data.delivery?.status) ||
        live(data.lease, cutoff) ||
        live(data.deliveryAuthorization, cutoff))
    )
      throw new Error('RESUME_STATE_CONFLICT');
    if (
      collection === 'message_digest_dispatch_outbox' &&
      (data.definitionId !== definition.path.split('/')[1] ||
        data.userId !== definition.data.userId ||
        !runIds.has(data.runId) ||
        data.status === 'terminal' ||
        live(data.claim, cutoff))
    )
      throw new Error('RESUME_STATE_CONFLICT');
  }
}

/** Each operation and its audit marker commit together. Replays only consult the marker. */
export async function applyResumeManifest({ manifest, expectedHash, store }) {
  if (manifest.schemaVersion !== 1 || hashResumeManifest(manifest) !== expectedHash)
    throw new Error('MANIFEST_HASH_MISMATCH');
  validateManifest(manifest);
  if (manifest.blocked.length !== 0) throw new Error('MANIFEST_HAS_BLOCKED_OPERATIONS');
  const binding = {
    projectId: manifest.projectId,
    cutoff: manifest.cutoff,
    manifestHash: expectedHash,
  };
  await store.reserve(binding);
  let applied = 0;
  let alreadyApplied = 0;
  for (const operation of manifest.operations) {
    const outcome = await store.transaction(
      operation,
      ({ committed, documents }) => {
        if (committed) return 'existing';
        if (
          documents.length !== operation.documents.length ||
          documents.some(
            (doc, index) =>
              doc === undefined ||
              doc.version !== operation.documents[index].expectedVersion ||
              doc.path !== operation.documents[index].path
          )
        )
          throw new Error('EXPECTED_VERSION_CONFLICT');
        validateOperationDocuments(operation, documents, manifest.cutoff);
        return 'applied';
      },
      manifest
    );
    if (outcome === 'existing') alreadyApplied++;
    else applied++;
  }
  await store.reconcileDerived?.(manifest, binding);
  await store.activate(binding);
  return { applied, alreadyApplied };
}
