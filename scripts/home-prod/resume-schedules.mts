import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { getFirestore, FieldValue, Timestamp } from '@intexuraos/infra-firestore';
import {
  buildResumeManifest,
  applyResumeManifest,
  hashResumeManifest,
  RESUME_COLLECTIONS,
} from './resume-schedules-lib.mjs';
import { getNextMessageDigestBoundary } from '../../apps/message-digest-service/src/domain/schedules/messageDigestSchedule.js';
import {
  calculateNextScheduleRunAt,
  validateScheduleCadence,
} from '../../apps/calendar-agent/src/domain/schedules/scheduleTime.js';
import { createTaskGroupSummaryFirestoreRepository } from '../../apps/code-agent/src/infra/firestore/taskGroupSummaryFirestoreRepository.js';

// No defaults for the target project, cutoff, manifest or apply hash.
const [mode, projectId, cutoff, manifestPath, expectedHash] = process.argv.slice(2);
if (
  !['dry-run', 'apply'].includes(mode ?? '') ||
  !projectId ||
  !cutoff ||
  !manifestPath ||
  !Number.isFinite(Date.parse(cutoff))
) {
  throw new Error(
    'Usage: pnpm exec tsx scripts/home-prod/resume-schedules.mts dry-run|apply PROJECT T0 MANIFEST [SHA256]'
  );
}
if (process.env['FIRESTORE_EMULATOR_HOST'] !== undefined)
  throw new Error('PRODUCTION_RESUME_REJECTS_EMULATOR');
process.env['INTEXURAOS_GCP_PROJECT_ID'] = projectId;
const firestore = getFirestore();
const version = (snapshot) =>
  snapshot.updateTime === undefined
    ? null
    : `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}`;
if (mode === 'dry-run') {
  const rows = [];
  for (const collection of RESUME_COLLECTIONS) {
    const snapshot = await firestore.collection(collection).get();
    rows.push(
      ...snapshot.docs.map((doc) => ({
        path: doc.ref.path,
        data: doc.data(),
        version: version(doc),
      }))
    );
  }
  const manifest = buildResumeManifest({
    projectId,
    cutoff,
    rows,
    nextCalendarBoundary: (schedule, now) => {
      if (!validateScheduleCadence(schedule.cadence).ok)
        throw new Error('INVALID_CALENDAR_CADENCE');
      return calculateNextScheduleRunAt({
        ...schedule.cadence,
        now,
        ...(schedule.lastRunLocalDate === undefined
          ? {}
          : { lastRunLocalDate: schedule.lastRunLocalDate }),
      });
    },
    nextDigestBoundary: (definition, now) => {
      const result = getNextMessageDigestBoundary(definition.schedule, now);
      if (!result.ok) throw new Error('INVALID_DIGEST_CADENCE');
      return result.value;
    },
  });
  const file = await open(
    manifestPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  );
  try {
    await file.writeFile(`${JSON.stringify(manifest, null, 2)}\n`);
  } finally {
    await file.close();
  }
  console.log(
    JSON.stringify({
      manifestHash: hashResumeManifest(manifest),
      operations: manifest.operations.length,
      blocked: manifest.blocked.length,
    })
  );
} else {
  if (!/^[0-9a-f]{64}$/.test(expectedHash ?? ''))
    throw new Error('EXPLICIT_MANIFEST_HASH_REQUIRED');
  const file = await open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let manifest;
  try {
    const stats = await file.stat();
    if (!stats.isFile() || (stats.mode & 0o077) !== 0 || stats.uid !== process.getuid?.())
      throw new Error('MANIFEST_MUST_BE_OWNER_ONLY_REGULAR_FILE');
    manifest = JSON.parse(await file.readFile('utf8'));
  } finally {
    await file.close();
  }
  if (manifest.projectId !== projectId || manifest.cutoff !== new Date(cutoff).toISOString())
    throw new Error('MANIFEST_TARGET_MISMATCH');
  const result = await applyResumeManifest({
    manifest,
    expectedHash,
    store: {
      async reserve(policy) {
        await firestore.runTransaction(async (transaction) => {
          const ref = firestore.collection('home_prod_resume_policy').doc('active');
          const snapshot = await transaction.get(ref);
          if (snapshot.exists) {
            const data = snapshot.data();
            if (
              data?.['cutoff'] !== policy.cutoff ||
              data['manifestHash'] !== policy.manifestHash ||
              data['projectId'] !== policy.projectId ||
              !['preparing', 'applied'].includes(data['status'])
            )
              throw new Error('RESUME_POLICY_BINDING_CONFLICT');
          } else transaction.create(ref, { schemaVersion: 1, ...policy, status: 'preparing' });
        });
      },
      async transaction(operation, decide, binding) {
        return await firestore.runTransaction(async (transaction) => {
          const policy = await transaction.get(
            firestore.collection('home_prod_resume_policy').doc('active')
          );
          const fence = policy.data();
          if (
            fence?.['cutoff'] !== binding.cutoff ||
            fence['manifestHash'] !== expectedHash ||
            fence['projectId'] !== binding.projectId ||
            !['preparing', 'applied'].includes(fence['status'])
          )
            throw new Error('RESUME_POLICY_BINDING_CONFLICT');
          const auditRef = firestore.collection('home_prod_resume_audit').doc(operation.id);
          const audit = await transaction.get(auditRef);
          if (audit.exists) {
            const data = audit.data();
            if (data?.['manifestHash'] !== expectedHash || data['cutoff'] !== binding.cutoff)
              throw new Error('AUDIT_BINDING_CONFLICT');
            return 'existing';
          }
          const snapshots = await Promise.all(
            operation.documents.map((doc) => transaction.get(firestore.doc(doc.path)))
          );
          const outcome = decide({
            committed: false,
            documents: snapshots.map((doc) => ({
              path: doc.ref.path,
              version: version(doc),
              data: doc.data(),
            })),
          });
          for (const document of operation.documents) {
            const patch = { ...document.patch };
            // Code-domain timestamps are Firestore Timestamp values, digest/calendar timestamps ISO strings.
            if (
              document.path.startsWith('code_tasks/') ||
              document.path.startsWith('merge_queue_watches/')
            ) {
              for (const field of ['statusChangedAt', 'completedAt', 'updatedAt', 'cancelledAt']) {
                if (typeof patch[field] === 'string')
                  patch[field] = Timestamp.fromDate(new Date(patch[field]));
              }
            }
            for (const field of document.remove) patch[field] = FieldValue.delete();
            transaction.update(firestore.doc(document.path), patch);
          }
          transaction.create(auditRef, {
            schemaVersion: 1,
            cutoff: binding.cutoff,
            manifestHash: expectedHash,
            kind: operation.kind,
            documentCount: operation.documents.length,
            appliedAt: new Date().toISOString(),
          });
          return outcome;
        });
      },
      async reconcileDerived(manifest, binding) {
        const groups = new Map();
        for (const operation of manifest.operations.filter((item) => item.kind === 'code_task')) {
          const task = await firestore.doc(operation.documents[0].path).get();
          const data = task.data();
          if (data?.['agentType'] === 'ask_agent') continue;
          if (typeof data?.['userId'] !== 'string') throw new Error('INVALID_CANCELLED_TASK_OWNER');
          const groupKey = data['linearIssueId'] ?? `standalone_${task.id}`;
          if (typeof groupKey !== 'string') throw new Error('INVALID_CANCELLED_TASK_GROUP');
          groups.set(JSON.stringify([data['userId'], groupKey]), {
            userId: data['userId'],
            groupKey,
          });
        }
        const summaries = createTaskGroupSummaryFirestoreRepository({
          firestore,
          authoritativeTaskReads: true,
          logger: { info() {}, warn() {}, error() {}, debug() {} },
        });
        for (const group of groups.values()) {
          const ref = firestore
            .collection('home_prod_resume_audit')
            .doc(`summary_${hashResumeManifest({ ...binding, ...group })}`);
          const prepare = await firestore.runTransaction(async (transaction) => {
            const policy = await transaction.get(
              firestore.collection('home_prod_resume_policy').doc('active')
            );
            const data = policy.data();
            if (
              data?.['cutoff'] !== binding.cutoff ||
              data['manifestHash'] !== binding.manifestHash ||
              data['projectId'] !== binding.projectId ||
              !['preparing', 'applied'].includes(data['status'])
            )
              throw new Error('RESUME_POLICY_BINDING_CONFLICT');
            const snapshot = await transaction.get(ref);
            if (snapshot.exists) {
              const audit = snapshot.data();
              if (
                audit?.['cutoff'] !== binding.cutoff ||
                audit['manifestHash'] !== binding.manifestHash
              )
                throw new Error('AUDIT_BINDING_CONFLICT');
              if (audit['status'] === 'applied') return false;
            }
            transaction.set(ref, {
              schemaVersion: 1,
              ...binding,
              kind: 'task_group_summary',
              ...group,
              status: 'preparing',
              startedAt: new Date().toISOString(),
            });
            return true;
          });
          if (!prepare) continue;
          const recomputed = await summaries.recomputeGroupFromSource(group.userId, group.groupKey);
          await firestore.runTransaction(async (transaction) => {
            const policy = await transaction.get(
              firestore.collection('home_prod_resume_policy').doc('active')
            );
            const data = policy.data();
            if (
              data?.['cutoff'] !== binding.cutoff ||
              data['manifestHash'] !== binding.manifestHash ||
              data['projectId'] !== binding.projectId ||
              !['preparing', 'applied'].includes(data['status'])
            )
              throw new Error('RESUME_POLICY_BINDING_CONFLICT');
            const audit = await transaction.get(ref);
            if (
              audit.data()?.['cutoff'] !== binding.cutoff ||
              audit.data()?.['manifestHash'] !== binding.manifestHash
            )
              throw new Error('AUDIT_BINDING_CONFLICT');
            if (audit.data()?.['status'] === 'applied') return;
            transaction.update(ref, {
              status: recomputed.ok ? 'applied' : 'failed',
              finishedAt: new Date().toISOString(),
              safeFailureCode: recomputed.ok ? null : 'DERIVED_GROUP_RECONCILIATION_FAILED',
            });
          });
          if (!recomputed.ok) throw new Error('DERIVED_GROUP_RECONCILIATION_FAILED');
        }
      },
      async activate(policy) {
        await firestore.runTransaction(async (transaction) => {
          const ref = firestore.collection('home_prod_resume_policy').doc('active');
          const snapshot = await transaction.get(ref);
          const data = snapshot.data();
          if (
            !snapshot.exists ||
            data?.['cutoff'] !== policy.cutoff ||
            data['manifestHash'] !== policy.manifestHash ||
            data['projectId'] !== policy.projectId ||
            !['preparing', 'applied'].includes(data['status'])
          )
            throw new Error('RESUME_POLICY_BINDING_CONFLICT');
          if (data['status'] !== 'applied')
            transaction.update(ref, { status: 'applied', appliedAt: new Date().toISOString() });
        });
      },
    },
  });
  console.log(JSON.stringify(result));
}
await firestore.terminate();
