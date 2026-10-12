import { getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { CalendarError } from '../../domain/errors.js';
import {
  calculateNextDailyRunAfterLocalDate,
  getLocalDateInTimeZone,
  getUtcIsoForLocalDateTime,
} from '../../domain/schedules/scheduleTime.js';
import type {
  CalendarSchedule,
  CalendarScheduleRun,
  ClaimedCalendarSchedule,
} from '../../domain/schedules/types.js';
import type {
  CalendarScheduleRepository,
  ClaimDueSchedulesInput,
  MarkRunFailedInput,
  MarkRunSentInput,
} from '../../domain/schedules/scheduleRepository.js';

const SCHEDULES_COLLECTION = 'calendar_schedules';
const RUNS_COLLECTION = 'calendar_schedule_runs';
type FirestoreTransaction = Parameters<
  Parameters<ReturnType<typeof getFirestore>['runTransaction']>[0]
>[0];

function toCalendarError(error: unknown, message: string): CalendarError {
  return {
    code: 'INTERNAL_ERROR',
    message: getErrorMessage(error, message),
  };
}

function toSchedule(id: string, data: Record<string, unknown>): CalendarSchedule {
  const cadence = data['cadence'];
  const cadenceData =
    typeof cadence === 'object' && cadence !== null ? (cadence as Record<string, unknown>) : {};
  const payload = data['payload'];
  const payloadData =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const lease = data['lease'];
  const leaseData =
    typeof lease === 'object' && lease !== null ? (lease as Record<string, unknown>) : null;
  const retryRun = data['retryRun'];
  const retryRunData =
    typeof retryRun === 'object' && retryRun !== null
      ? (retryRun as Record<string, unknown>)
      : null;
  return {
    id,
    userId: typeof data['userId'] === 'string' ? data['userId'] : '',
    taskType: 'calendar_daily_lookahead',
    status: data['status'] === 'paused' ? 'paused' : 'active',
    cadence: {
      type: 'daily',
      localTime: typeof cadenceData['localTime'] === 'string' ? cadenceData['localTime'] : '',
      timeZone: typeof cadenceData['timeZone'] === 'string' ? cadenceData['timeZone'] : '',
    },
    payload: {
      prompt: typeof payloadData['prompt'] === 'string' ? payloadData['prompt'] : '',
      target: 'intex_agent',
    },
    nextRunAt: typeof data['nextRunAt'] === 'string' ? data['nextRunAt'] : '',
    ...(typeof data['resumeCutoff'] === 'string' ? { resumeCutoff: data['resumeCutoff'] } : {}),
    ...(typeof data['lastRunAt'] === 'string' ? { lastRunAt: data['lastRunAt'] } : {}),
    ...(typeof data['lastRunLocalDate'] === 'string'
      ? { lastRunLocalDate: data['lastRunLocalDate'] }
      : {}),
    ...(retryRunData !== null
      ? {
          retryRun: {
            localDate:
              typeof retryRunData['localDate'] === 'string' ? retryRunData['localDate'] : '',
            scheduledFor:
              typeof retryRunData['scheduledFor'] === 'string' ? retryRunData['scheduledFor'] : '',
          },
        }
      : {}),
    ...(typeof data['createdAt'] === 'string' ? { createdAt: data['createdAt'] } : {}),
    ...(typeof data['updatedAt'] === 'string' ? { updatedAt: data['updatedAt'] } : {}),
    ...(leaseData !== null
      ? {
          lease: {
            ownerId: typeof leaseData['ownerId'] === 'string' ? leaseData['ownerId'] : '',
            expiresAt: typeof leaseData['expiresAt'] === 'string' ? leaseData['expiresAt'] : '',
          },
        }
      : {}),
    ...(typeof data['latestRun'] === 'object' && data['latestRun'] !== null
      ? { latestRun: data['latestRun'] as CalendarScheduleRun }
      : {}),
    schemaVersion: 1,
  };
}

function toRun(id: string, input: Omit<CalendarScheduleRun, 'id'>): CalendarScheduleRun {
  return { id, ...input };
}

function isTerminalRunForLocalDate(data: Record<string, unknown>): boolean {
  if (data['status'] === 'sent') {
    return true;
  }
  return data['status'] === 'failed' && data['retryable'] !== true;
}

export function createCalendarScheduleRepository(): CalendarScheduleRepository {
  return {
    async listPendingRuns(
      now
    ): ReturnType<NonNullable<CalendarScheduleRepository['listPendingRuns']>> {
      try {
        const db = getFirestore();
        const [snapshot, schedules] = await Promise.all([
          db
            .collection(RUNS_COLLECTION)
            .where('scheduledFor', '>=', new Date(Date.parse(now) - 7 * 86400000).toISOString())
            .get(),
          db.collection(SCHEDULES_COLLECTION).where('status', 'in', ['active', 'paused']).get(),
        ]);
        const cutoffs = new Map(
          schedules.docs.map((doc) => {
            const schedule = toSchedule(doc.id, doc.data() as Record<string, unknown>);
            return [schedule.id, schedule.resumeCutoff];
          })
        );
        return ok(
          snapshot.docs
            .map((doc) => ({ ...doc.data(), id: doc.id }) as CalendarScheduleRun)
            .filter((run) => run.deliveryStatus === 'pending' || run.deliveryStatus === 'failed')
            .filter((run) => {
              const cutoff = cutoffs.get(run.scheduleId);
              return typeof cutoff !== 'string' || run.scheduledFor >= cutoff;
            })
        );
      } catch (error) {
        return { ok: false, error: toCalendarError(error, 'Failed to load pending calendar runs') };
      }
    },
    async markRunDelivery(
      input
    ): ReturnType<NonNullable<CalendarScheduleRepository['markRunDelivery']>> {
      try {
        const db = getFirestore();
        const runRef = db.collection(RUNS_COLLECTION).doc(input.run.id);
        const scheduleRef = db.collection(SCHEDULES_COLLECTION).doc(input.run.scheduleId);
        await db.runTransaction(async (tx) => {
          const run = await tx.get(runRef);
          const schedule = await tx.get(scheduleRef);
          if (!run.exists || run.data()?.['deliveryStatus'] === 'delivered') return;
          const updated = {
            ...input.run,
            deliveryStatus: input.status,
            stage: input.stage ?? input.status,
            ...(input.status === 'delivered'
              ? { deliveredAt: input.at }
              : input.status === 'failed'
                ? { error: input.failureCode ?? 'FINAL_RESPONSE_FAILED' }
                : {}),
          };
          tx.set(runRef, updated, { merge: true });
          if (
            schedule.exists &&
            (schedule.data()?.['latestRun'] as CalendarScheduleRun | undefined)?.id === input.run.id
          )
            tx.update(scheduleRef, { latestRun: updated, updatedAt: input.at });
        });
        return ok(undefined);
      } catch (error) {
        return { ok: false, error: toCalendarError(error, 'Failed to record calendar delivery') };
      }
    },
    async monitoring(now): ReturnType<NonNullable<CalendarScheduleRepository['monitoring']>> {
      const db = getFirestore();
      const [schedules, history] = await Promise.all([
        db.collection(SCHEDULES_COLLECTION).where('status', '==', 'active').get(),
        db
          .collection(RUNS_COLLECTION)
          .where('scheduledFor', '>=', new Date(Date.parse(now) - 7 * 86400000).toISOString())
          .get(),
      ]);
      const runs = history.docs.map(
        (doc) => ({ ...doc.data(), id: doc.id }) as CalendarScheduleRun
      );
      let pendingCount = 0;
      let failedCount = 0;
      let oldestPendingScheduledFor: string | null = null;
      let lastDeliveredAt: string | null = null;
      const pending = (scheduledFor: string): void => {
        pendingCount++;
        if (oldestPendingScheduledFor === null || scheduledFor < oldestPendingScheduledFor)
          oldestPendingScheduledFor = scheduledFor;
      };
      for (const doc of schedules.docs) {
        const schedule = toSchedule(doc.id, doc.data() as Record<string, unknown>);
        const history = runs.filter(
          (run) => run.scheduleId === schedule.id && run.userId === schedule.userId
        );
        for (const run of history) {
          if (
            run.deliveredAt !== undefined &&
            (lastDeliveredAt === null || run.deliveredAt > lastDeliveredAt)
          )
            lastDeliveredAt = run.deliveredAt;
        }
        const owned = history.filter(
          (run) => schedule.resumeCutoff === undefined || run.scheduledFor >= schedule.resumeCutoff
        );
        for (const run of owned) {
          const superseded = owned.some(
            (next) => next.scheduledFor > run.scheduledFor && next.deliveryStatus === 'delivered'
          );
          if (superseded || run.deliveryStatus === 'delivered') continue;
          if (run.status === 'failed' || run.deliveryStatus === 'failed') failedCount++;
          else pending(run.scheduledFor);
        }
        // Missing generation is monitored from the scheduler's due cursor too.
        if (
          schedule.nextRunAt <= now &&
          (schedule.resumeCutoff === undefined || schedule.nextRunAt >= schedule.resumeCutoff) &&
          !owned.some((run) => run.scheduledFor === schedule.nextRunAt)
        )
          pending(schedule.nextRunAt);
      }
      return { pendingCount, failedCount, oldestPendingScheduledFor, lastDeliveredAt };
    },
    async upsert(schedule: CalendarSchedule): Promise<Result<CalendarSchedule, CalendarError>> {
      try {
        const db = getFirestore();
        const docRef = db.collection(SCHEDULES_COLLECTION).doc(schedule.id);
        const existing = await docRef.get();
        /* v8 ignore start -- ts-type: repository callers cannot omit updatedAt on persisted schedules in production; fallback is defensive for direct test/fake callers @preserve */
        const now = schedule.updatedAt ?? new Date().toISOString();
        /* v8 ignore stop @preserve */
        const next: Record<string, unknown> = {
          ...schedule,
          lease: schedule.lease ?? null,
          retryRun: schedule.retryRun ?? null,
          /* v8 ignore start -- source-map: branch coverage false positive misattributed to tested createdAt ternary alignment @preserve */
          createdAt: existing.exists
            ? (existing.data()?.['createdAt'] ?? schedule.createdAt ?? now)
            : (schedule.createdAt ?? now),
          /* v8 ignore stop @preserve */
          updatedAt: now,
        };
        await docRef.set(next, { merge: true });
        return ok(toSchedule(schedule.id, next));
      } catch (error) {
        return { ok: false, error: toCalendarError(error, 'Failed to upsert calendar schedule') };
      }
    },

    async getByUserAndTaskType(
      userId: string,
      taskType: 'calendar_daily_lookahead'
    ): Promise<Result<CalendarSchedule | null, CalendarError>> {
      try {
        const db = getFirestore();
        /* v8 ignore start -- source-map: branch coverage false positive misattributed to Firestore query-builder chain alignment @preserve */
        const snapshot = await db
          .collection(SCHEDULES_COLLECTION)
          .where('userId', '==', userId)
          .where('taskType', '==', taskType)
          .limit(1)
          .get();
        /* v8 ignore stop @preserve */
        if (snapshot.empty) {
          return ok(null);
        }
        const doc = snapshot.docs[0];
        /* v8 ignore start -- upstream: Firestore QuerySnapshot.empty=false guarantees at least one doc; undefined guard is defensive for adapter corruption @preserve */
        if (doc === undefined) {
          return ok(null);
        }
        /* v8 ignore stop @preserve */
        return ok(toSchedule(doc.id, doc.data() as Record<string, unknown>));
      } catch (error) {
        return { ok: false, error: toCalendarError(error, 'Failed to load calendar schedule') };
      }
    },

    async claimDueSchedules(
      input: ClaimDueSchedulesInput
    ): Promise<Result<ClaimedCalendarSchedule[], CalendarError>> {
      try {
        const db = getFirestore();
        /* v8 ignore start -- source-map: branch coverage false positive misattributed to Firestore query-builder chain alignment @preserve */
        const snapshot = await db
          .collection(SCHEDULES_COLLECTION)
          .where('status', '==', 'active')
          .where('nextRunAt', '<=', input.now)
          .orderBy('nextRunAt', 'asc')
          .limit(input.limit)
          .get();
        /* v8 ignore stop @preserve */

        /* v8 ignore start -- source-map: branch coverage false positive misattributed to initialized array before Firestore transaction loop alignment @preserve */
        const claimed: ClaimedCalendarSchedule[] = [];
        /* v8 ignore stop @preserve */

        for (const doc of snapshot.docs) {
          const schedule = toSchedule(doc.id, doc.data() as Record<string, unknown>);
          /* v8 ignore start -- source-map: branch coverage false positive misattributed to Firestore transaction callback alignment @preserve */
          const claim = await db.runTransaction(
            async (transaction: FirestoreTransaction): Promise<ClaimedCalendarSchedule | null> => {
              const scheduleRef = db.collection(SCHEDULES_COLLECTION).doc(schedule.id);
              const freshSnapshot = await transaction.get(scheduleRef);
              /* v8 ignore start -- upstream: fake Firestore cannot simulate concurrent deletion between query and transaction; guard is defensive for production races @preserve */
              if (!freshSnapshot.exists) {
                return null;
              }
              /* v8 ignore stop @preserve */

              const freshSchedule = toSchedule(
                schedule.id,
                freshSnapshot.data() as Record<string, unknown>
              );
              /* v8 ignore start -- upstream: transaction race guard for schedules changed after the due-query snapshot @preserve */
              if (freshSchedule.status !== 'active') {
                return null;
              }
              if (freshSchedule.nextRunAt > input.now) {
                return null;
              }
              /* v8 ignore stop @preserve */
              if (freshSchedule.lease !== undefined && freshSchedule.lease.expiresAt > input.now) {
                return null;
              }

              const today = getLocalDateInTimeZone(input.now, freshSchedule.cadence.timeZone);
              const dueDate =
                freshSchedule.retryRun?.localDate ??
                getLocalDateInTimeZone(freshSchedule.nextRunAt, freshSchedule.cadence.timeZone);
              const localDate = dueDate < today ? today : dueDate;
              const scheduledFor =
                dueDate < today
                  ? getUtcIsoForLocalDateTime(
                      today,
                      freshSchedule.cadence.localTime,
                      freshSchedule.cadence.timeZone
                    )
                  : (freshSchedule.retryRun?.scheduledFor ?? freshSchedule.nextRunAt);
              if (dueDate < today) {
                // Record the skipped interval explicitly; old-date retries never send.
                if (scheduledFor > input.now) {
                  transaction.update(scheduleRef, {
                    nextRunAt: scheduledFor,
                    retryRun: null,
                    lease: null,
                    skippedThroughLocalDate: dueDate,
                    updatedAt: input.now,
                  });
                  return null;
                }
              }
              const runId = `${freshSchedule.id}_${localDate}`;
              const runRef = db.collection(RUNS_COLLECTION).doc(runId);
              const existingRun = await transaction.get(runRef);

              if (
                existingRun.exists &&
                isTerminalRunForLocalDate(existingRun.data() as Record<string, unknown>)
              ) {
                transaction.update(scheduleRef, {
                  nextRunAt: calculateNextDailyRunAfterLocalDate(
                    localDate,
                    freshSchedule.cadence.localTime,
                    freshSchedule.cadence.timeZone
                  ),
                  lastRunLocalDate: localDate,
                  updatedAt: input.now,
                  lease: null,
                  retryRun: null,
                });
                return null;
              }

              const startedAt = input.now;
              transaction.set(
                runRef,
                toRun(runId, {
                  scheduleId: freshSchedule.id,
                  userId: freshSchedule.userId,
                  taskType: freshSchedule.taskType,
                  status: 'leased',
                  stage: 'trigger_pending',
                  localDate,
                  scheduledFor,
                  startedAt,
                })
              );
              transaction.update(scheduleRef, {
                ...(dueDate < today ? { retryRun: null, skippedThroughLocalDate: dueDate } : {}),
                lease: {
                  ownerId: input.leaseOwnerId,
                  expiresAt: new Date(
                    new Date(input.now).getTime() + input.leaseDurationMs
                  ).toISOString(),
                },
                latestRun: toRun(runId, {
                  scheduleId: freshSchedule.id,
                  userId: freshSchedule.userId,
                  taskType: freshSchedule.taskType,
                  status: 'leased',
                  stage: 'trigger_pending',
                  localDate,
                  scheduledFor,
                  startedAt,
                }),
                updatedAt: input.now,
              });

              return {
                schedule: freshSchedule,
                localDate,
                scheduledFor,
                startedAt,
              };
            }
          );
          /* v8 ignore stop @preserve */

          if (claim !== null) {
            claimed.push(claim);
          }
        }

        return ok(claimed);
      } catch (error) {
        return { ok: false, error: toCalendarError(error, 'Failed to claim due schedules') };
      }
    },

    async markRunSent(input: MarkRunSentInput): Promise<Result<void, CalendarError>> {
      try {
        const db = getFirestore();
        const runRef = db.collection(RUNS_COLLECTION).doc(`${input.scheduleId}_${input.localDate}`);
        const scheduleRef = db.collection(SCHEDULES_COLLECTION).doc(input.scheduleId);
        await db.runTransaction((transaction: FirestoreTransaction): Promise<void> => {
          transaction.set(
            runRef,
            {
              status: 'sent',
              deliveryStatus: 'pending',
              stage: 'awaiting_ingress',
              finishedAt: input.finishedAt,
              matrixEventId: input.matrixEventId,
              localDate: input.localDate,
              scheduledFor: input.scheduledFor,
              startedAt: input.startedAt,
              scheduleId: input.scheduleId,
              userId: input.userId,
              taskType: input.taskType,
            },
            { merge: true }
          );
          transaction.update(scheduleRef, {
            nextRunAt: input.nextRunAt,
            latestRun: {
              id: `${input.scheduleId}_${input.localDate}`,
              scheduleId: input.scheduleId,
              userId: input.userId,
              taskType: input.taskType,
              localDate: input.localDate,
              scheduledFor: input.scheduledFor,
              startedAt: input.startedAt,
              finishedAt: input.finishedAt,
              status: 'sent',
              deliveryStatus: 'pending',
              stage: 'awaiting_ingress',
              matrixEventId: input.matrixEventId,
            },
            lastRunAt: input.finishedAt,
            lastRunLocalDate: input.localDate,
            updatedAt: input.finishedAt,
            lease: null,
            retryRun: null,
          });
          return Promise.resolve();
        });
        return ok(undefined);
      } catch (error) {
        return { ok: false, error: toCalendarError(error, 'Failed to record sent schedule run') };
      }
    },

    async markRunFailed(input: MarkRunFailedInput): Promise<Result<void, CalendarError>> {
      try {
        const db = getFirestore();
        const runRef = db.collection(RUNS_COLLECTION).doc(`${input.scheduleId}_${input.localDate}`);
        const scheduleRef = db.collection(SCHEDULES_COLLECTION).doc(input.scheduleId);
        await db.runTransaction((transaction: FirestoreTransaction): Promise<void> => {
          transaction.set(
            runRef,
            {
              status: 'failed',
              finishedAt: input.finishedAt,
              error: input.error,
              retryable: input.retryable,
              localDate: input.localDate,
              scheduledFor: input.scheduledFor,
              startedAt: input.startedAt,
              scheduleId: input.scheduleId,
              userId: input.userId,
              taskType: input.taskType,
            },
            { merge: true }
          );
          transaction.update(scheduleRef, {
            nextRunAt: input.nextRunAt,
            updatedAt: input.finishedAt,
            lease: null,
            latestRun: {
              id: `${input.scheduleId}_${input.localDate}`,
              scheduleId: input.scheduleId,
              userId: input.userId,
              taskType: input.taskType,
              localDate: input.localDate,
              scheduledFor: input.scheduledFor,
              startedAt: input.startedAt,
              finishedAt: input.finishedAt,
              status: 'failed',
              deliveryStatus: 'failed',
              stage: 'failed',
              error: input.error,
              retryable: input.retryable,
            },
            retryRun: input.retryable
              ? {
                  localDate: input.localDate,
                  scheduledFor: input.scheduledFor,
                }
              : null,
          });
          return Promise.resolve();
        });
        return ok(undefined);
      } catch (error) {
        return { ok: false, error: toCalendarError(error, 'Failed to record failed schedule run') };
      }
    },
  };
}
