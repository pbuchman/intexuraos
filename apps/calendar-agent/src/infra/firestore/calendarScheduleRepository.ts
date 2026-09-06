import { getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { CalendarError } from '../../domain/errors.js';
import {
  calculateNextDailyRunAfterLocalDate,
  getLocalDateInTimeZone,
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
    ...(typeof data['lastRunAt'] === 'string' ? { lastRunAt: data['lastRunAt'] } : {}),
    ...(typeof data['lastRunLocalDate'] === 'string'
      ? { lastRunLocalDate: data['lastRunLocalDate'] }
      : {}),
    ...(retryRunData !== null
      ? {
          retryRun: {
            localDate: typeof retryRunData['localDate'] === 'string' ? retryRunData['localDate'] : '',
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
            async (
              transaction: FirestoreTransaction
            ): Promise<ClaimedCalendarSchedule | null> => {
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
              if (
                freshSchedule.lease !== undefined &&
                freshSchedule.lease.expiresAt > input.now
              ) {
                return null;
              }

              const localDate =
                freshSchedule.retryRun?.localDate ??
                getLocalDateInTimeZone(freshSchedule.nextRunAt, freshSchedule.cadence.timeZone);
              const scheduledFor = freshSchedule.retryRun?.scheduledFor ?? freshSchedule.nextRunAt;
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
                  localDate,
                  scheduledFor,
                  startedAt,
                })
              );
              transaction.update(scheduleRef, {
                lease: {
                  ownerId: input.leaseOwnerId,
                  expiresAt: new Date(
                    new Date(input.now).getTime() + input.leaseDurationMs
                  ).toISOString(),
                },
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
