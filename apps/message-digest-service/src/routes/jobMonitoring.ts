import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticateInternalScheduler, validateInternalAuth } from '@intexuraos/common-http';
import type { NotificationMonitoringSummary } from '@intexuraos/common-core';
import type { JobExecutionToken, JobHeartbeatStore, Firestore } from '@intexuraos/infra-firestore';
import type { MessageDigestRun } from '../domain/models/messageDigestRun.js';

export function registerDigestJobMonitoring(
  app: FastifyInstance,
  getStore: () => JobHeartbeatStore | undefined,
  getSummary: () => Promise<NotificationMonitoringSummary>
): void {
  const executions = new WeakMap<
    FastifyRequest,
    { store: JobHeartbeatStore; token: JobExecutionToken }
  >();
  app.addHook('preHandler', async (request, reply) => {
    if (
      request.method !== 'POST' ||
      request.routeOptions.url !== '/internal/message-digests/scheduler/tick'
    )
      return;
    if (!authenticateInternalScheduler(request).authenticated) {
      await reply.fail('UNAUTHORIZED', 'Unauthorized');
      return;
    }
    const store = getStore();
    if (store !== undefined)
      executions.set(request, { store, token: await store.start('message_digest_tick') });
  });
  app.addHook('onSend', async (request, reply, payload) => {
    const execution = executions.get(request);
    if (execution === undefined) return payload;
    executions.delete(request);
    let failed = reply.statusCode >= 400;
    if (!failed) {
      try {
        const body = JSON.parse(String(payload)) as {
          success?: boolean;
          data?: { ok?: boolean; failures?: number };
        };
        failed =
          body.success === false || body.data?.ok === false || (body.data?.failures ?? 0) > 0;
      } catch {
        failed = true;
      }
    }
    await execution.store.finish(execution.token, failed ? 'failed' : 'succeeded');
    return payload;
  });
  app.get('/internal/monitoring/status', async (request, reply) => {
    if (!validateInternalAuth(request).valid)
      return await reply.fail('UNAUTHORIZED', 'Unauthorized');
    const store = getStore();
    if (store === undefined)
      return await reply.fail('SERVICE_UNAVAILABLE', 'Monitoring unavailable');
    const [jobs, notifications] = await Promise.all([
      store.list(['message_digest_tick']),
      getSummary(),
    ]);
    return await reply.ok({
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      jobs,
      notifications,
    });
  });
}

interface MonitoredRun {
  definitionId: string;
  userId: string;
  generationStatus: MessageDigestRun['generationStatus'];
  safeFailureCode?: string | null;
  deliveryMode?: MessageDigestRun['deliveryMode'];
  scheduledBoundary: string;
  windowEnd?: string;
  delivery: Pick<MessageDigestRun['delivery'], 'status' | 'transportConfirmation'> & {
    failureCode?: string | null;
  };
}

interface MonitoredDefinition {
  definitionId: string;
  userId: string;
  status: string;
  nextRunAt: string;
  resumeCutoff?: string;
}

export function summarizeDigestNotifications(
  runs: readonly MonitoredRun[],
  definitions: readonly MonitoredDefinition[],
  now: string
): NotificationMonitoringSummary {
  const result: NotificationMonitoringSummary = {
    pendingCount: 0,
    failedCount: 0,
    oldestPendingScheduledFor: null,
    lastDeliveredAt: null,
  };
  const pending = (scheduledFor: string): void => {
    result.pendingCount += 1;
    if (
      result.oldestPendingScheduledFor === null ||
      scheduledFor < result.oldestPendingScheduledFor
    )
      result.oldestPendingScheduledFor = scheduledFor;
  };
  for (const definition of definitions) {
    if (definition.status !== 'active') continue;
    const history = runs.filter(
      (run) =>
        run.definitionId === definition.definitionId &&
        run.userId === definition.userId &&
        run.deliveryMode !== 'silent' &&
        ![run.delivery.failureCode, run.safeFailureCode].some(
          (code) => code === 'SKIPPED_BEFORE_RESUME' || code === 'OBSOLETE_SCHEDULE_WINDOW'
        )
    );
    let deliveredThrough: string | null = null;
    for (const run of history) {
      const confirmation = run.delivery.transportConfirmation;
      if (confirmation?.status !== 'delivered' && confirmation?.status !== 'read') continue;
      if (deliveredThrough === null || run.scheduledBoundary > deliveredThrough)
        deliveredThrough = run.scheduledBoundary;
      const at = confirmation.deliveredAt ?? confirmation.readAt;
      if (at !== undefined && (result.lastDeliveredAt === null || at > result.lastDeliveredAt))
        result.lastDeliveredAt = at;
    }
    const current = history.filter(
      (run) =>
        definition.resumeCutoff === undefined ||
        (run.scheduledBoundary >= definition.resumeCutoff &&
          (run.windowEnd === undefined || run.windowEnd >= definition.resumeCutoff))
    );
    for (const run of current) {
      if (deliveredThrough !== null && run.scheduledBoundary <= deliveredThrough) continue;
      if (run.generationStatus === 'skipped_no_activity') continue;
      const confirmation = run.delivery.transportConfirmation;
      if (
        run.generationStatus === 'failed' ||
        run.delivery.status === 'failed' ||
        confirmation?.status === 'failed'
      ) {
        result.failedCount += 1;
      } else {
        pending(run.scheduledBoundary);
      }
    }
    if (
      definition.nextRunAt <= now &&
      (definition.resumeCutoff === undefined || definition.nextRunAt >= definition.resumeCutoff) &&
      !current.some((run) => run.scheduledBoundary >= definition.nextRunAt)
    )
      pending(definition.nextRunAt);
  }
  return result;
}

export async function getDigestNotificationSummary(
  firestore: Firestore,
  now = new Date().toISOString()
): Promise<NotificationMonitoringSummary> {
  const snapshot = await firestore
    .collection('message_digest_definitions')
    .where('status', '==', 'active')
    .get();
  const definitions = snapshot.docs.map((doc) => doc.data() as MonitoredDefinition);
  const runs = await Promise.all(
    definitions.map(async (definition) => {
      const history = await firestore
        .collection('message_digest_runs')
        .where('userId', '==', definition.userId)
        .where('definitionId', '==', definition.definitionId)
        .where('recordRole', '==', 'canonical')
        .where('visibilityMigrationId', '==', null)
        .get();
      return history.docs.map((doc) => doc.data() as MonitoredRun);
    })
  );
  return summarizeDigestNotifications(runs.flat(), definitions, now);
}
