import { createHash, randomUUID } from 'node:crypto';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { Timestamp, type Firestore } from '@intexuraos/infra-firestore';
import type { Logger } from 'pino';
import type {
  AcquireSentryTaskReservationInput,
  AcquireSentryTaskReservationResult,
  CheckpointSentryLinearIssueInput,
  CompleteSentryTaskReservationInput,
  FailSentryTaskReservationInput,
  NormalizedSentryIssueEvent,
  SentryTaskReservationState,
} from '../../domain/models/sentryIssueEvent.js';
import type {
  SentryIssueEventRepository,
  SentryIssueEventRepositoryError,
} from '../../domain/repositories/sentryIssueEventRepository.js';

const COLLECTION_NAME = 'sentry-issue-events';

interface SentryIssueEventDoc {
  dedupeKey: string;
  transitionKey: string;
  recordType: 'transition' | 'issue';
  state: SentryTaskReservationState;
  organizationSlug: string;
  projectSlug: string;
  projectId: string | null;
  issueId: string;
  issueShortId: string | null;
  issueTitle: string;
  issueUrl: string;
  action: string;
  resource: NormalizedSentryIssueEvent['resource'];
  status: string | null;
  eventId: string | null;
  receivedAt: unknown;
  latestReceivedAt: unknown;
  duplicateCount: number;
  payload: string;
  proposedCodeTaskId: string;
  leaseToken: string | null;
  leaseExpiresAt: unknown;
  leaseOwner: string | null;
  failureReason: string | null;
  codeTaskId: string | null;
  linearIssueId: string | null;
}

interface ReservationView {
  transitionKey: string | undefined;
  state: SentryTaskReservationState;
  receivedAt: Date;
  duplicateCount: number;
  proposedCodeTaskId: string;
  leaseToken: string | undefined;
  leaseExpiresAt: Date | undefined;
  leaseOwner: string | undefined;
  codeTaskId: string | undefined;
  linearIssueId: string | undefined;
  failureReason: string | undefined;
  eventId: string | undefined;
}

function nonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function toOptionalDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toReservationView(
  data: Record<string, unknown>,
  fallback: { receivedAt: Date; proposedCodeTaskId: string }
): ReservationView {
  const codeTaskId = nonBlankString(data['codeTaskId']);
  const rawState = data['state'];
  const state: SentryTaskReservationState =
    rawState === 'reserved' || rawState === 'task_created' || rawState === 'failed'
      ? rawState
      : codeTaskId !== undefined
        ? 'task_created'
        : 'failed';
  return {
    transitionKey: nonBlankString(data['transitionKey']),
    state,
    receivedAt: toOptionalDate(data['receivedAt']) ?? fallback.receivedAt,
    duplicateCount: typeof data['duplicateCount'] === 'number' ? data['duplicateCount'] : 0,
    proposedCodeTaskId:
      nonBlankString(data['proposedCodeTaskId']) ?? codeTaskId ?? fallback.proposedCodeTaskId,
    leaseToken: nonBlankString(data['leaseToken']),
    leaseExpiresAt: toOptionalDate(data['leaseExpiresAt']),
    leaseOwner: nonBlankString(data['leaseOwner']),
    codeTaskId,
    linearIssueId: nonBlankString(data['linearIssueId']),
    failureReason: nonBlankString(data['failureReason']),
    eventId: nonBlankString(data['eventId']),
  };
}

function normalizeKeySegment(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

function normalizeAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  return normalized === '' ? 'unknown' : normalizeKeySegment(normalized);
}

function getProjectIdentity(event: NormalizedSentryIssueEvent): string {
  return event.projectSlug;
}

function stableIdentityMatches(
  data: Record<string, unknown>,
  event: NormalizedSentryIssueEvent
): boolean {
  const organizationSlug = nonBlankString(data['organizationSlug']);
  if (
    organizationSlug === undefined
    || normalizeKeySegment(organizationSlug) !== normalizeKeySegment(event.organizationSlug)
  ) {
    return false;
  }
  const eventProjects = new Set(
    [event.projectSlug, event.projectId]
      .filter((value): value is string => value !== undefined && value.trim() !== '')
      .map(normalizeKeySegment)
  );
  return [data['projectSlug'], data['projectId']].some(
    (value) => typeof value === 'string' && eventProjects.has(normalizeKeySegment(value))
  );
}

function isSameTransitionData(
  data: Record<string, unknown>,
  event: NormalizedSentryIssueEvent
): boolean {
  const eventId = event.eventId?.trim();
  if (eventId !== undefined && eventId !== '') {
    return nonBlankString(data['eventId']) === eventId;
  }
  return data['resource'] === event.resource
    && normalizeAction(nonBlankString(data['action']) ?? '') === normalizeAction(event.action);
}

export function createSentryIssueDedupeKey(event: NormalizedSentryIssueEvent): string {
  const prefix = [
    'sentry',
    normalizeKeySegment(event.organizationSlug),
    normalizeKeySegment(getProjectIdentity(event)),
    normalizeKeySegment(event.issueId),
  ].join(':');
  const eventId = event.eventId?.trim();
  if (eventId !== undefined && eventId !== '') {
    return `${prefix}:event:${normalizeKeySegment(eventId)}`;
  }
  return `${prefix}:${event.resource}:${normalizeAction(event.action)}`;
}

export function createSentryProblemDedupeKey(event: NormalizedSentryIssueEvent): string {
  return [
    'sentry-task',
    normalizeKeySegment(event.organizationSlug),
    normalizeKeySegment(getProjectIdentity(event)),
    normalizeKeySegment(event.issueId),
  ].join(':');
}

function createLegacyTransitionKey(event: NormalizedSentryIssueEvent): string {
  return [
    'sentry',
    event.organizationSlug,
    event.projectSlug,
    event.issueId,
    event.resource,
    event.action.trim().toLowerCase() || 'unknown',
  ].join(':');
}

function normalizeProblemTitle(title: string): string {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized === '' ? 'unknown' : normalized;
}

function createLegacyProblemKey(event: NormalizedSentryIssueEvent): string {
  const projectIdentity = event.projectId ?? event.projectSlug;
  const fingerprint = createHash('sha256')
    .update(`${event.organizationSlug}\0${projectIdentity}\0${normalizeProblemTitle(event.issueTitle)}`)
    .digest('hex')
    .slice(0, 32);
  return `sentry-task:${event.organizationSlug}:${projectIdentity}:${fingerprint}`;
}

function serializePayload(payload: unknown): string {
  return JSON.stringify(payload ?? null);
}

function firestoreError(error: unknown): SentryIssueEventRepositoryError {
  return {
    code: 'FIRESTORE_ERROR',
    message: getErrorMessage(error, 'Unknown error'),
  };
}

function buildDoc(input: {
  dedupeKey: string;
  transitionKey: string;
  recordType: 'transition' | 'issue';
  reservation: ReservationView;
  event: NormalizedSentryIssueEvent;
  latestReceivedAt: Date;
  duplicateCount: number;
  payload: string;
  state: SentryTaskReservationState;
  proposedCodeTaskId: string;
  leaseToken?: string | undefined;
  leaseExpiresAt?: Date | undefined;
  leaseOwner?: string | undefined;
  failureReason?: string | undefined;
  codeTaskId?: string | undefined;
  linearIssueId?: string | undefined;
}): SentryIssueEventDoc {
  return {
    dedupeKey: input.dedupeKey,
    transitionKey: input.transitionKey,
    recordType: input.recordType,
    state: input.state,
    organizationSlug: input.event.organizationSlug,
    projectSlug: input.event.projectSlug,
    projectId: input.event.projectId ?? null,
    issueId: input.event.issueId,
    issueShortId: input.event.issueShortId ?? null,
    issueTitle: input.event.issueTitle,
    issueUrl: input.event.issueUrl,
    action: input.event.action,
    resource: input.event.resource,
    status: input.event.status ?? null,
    eventId: input.event.eventId ?? null,
    receivedAt: Timestamp.fromDate(input.reservation.receivedAt),
    latestReceivedAt: Timestamp.fromDate(input.latestReceivedAt),
    duplicateCount: input.duplicateCount,
    payload: input.payload,
    proposedCodeTaskId: input.proposedCodeTaskId,
    leaseToken: input.leaseToken ?? null,
    leaseExpiresAt:
      input.leaseExpiresAt !== undefined ? Timestamp.fromDate(input.leaseExpiresAt) : null,
    leaseOwner: input.leaseOwner ?? null,
    failureReason: input.failureReason ?? null,
    codeTaskId: input.codeTaskId ?? null,
    linearIssueId: input.linearIssueId ?? null,
  };
}

function isLeaseActive(reservation: ReservationView, receivedAt: Date): boolean {
  return reservation.state === 'reserved'
    && reservation.leaseExpiresAt !== undefined
    && reservation.leaseExpiresAt.getTime() > receivedAt.getTime();
}

function isSameLegacyTransition(
  reservation: ReservationView,
  event: NormalizedSentryIssueEvent
): boolean {
  const eventId = nonBlankString(event.eventId);
  if (eventId === undefined) return true;
  return reservation.eventId === eventId;
}

export function createFirestoreSentryIssueEventRepository(deps: {
  firestore: Firestore;
  logger: Logger;
}): SentryIssueEventRepository {
  const { firestore, logger } = deps;
  const collection = firestore.collection(COLLECTION_NAME);

  async function acquire(
    input: AcquireSentryTaskReservationInput
  ): Promise<Result<AcquireSentryTaskReservationResult, SentryIssueEventRepositoryError>> {
    const transitionKey = createSentryIssueDedupeKey(input.event);
    const issueKey = createSentryProblemDedupeKey(input.event);
    const legacyTransitionKey = createLegacyTransitionKey(input.event);
    const legacyIssueKey = createLegacyProblemKey(input.event);
    const payload = serializePayload(input.payload);

    try {
      return await firestore.runTransaction(async (transaction) => {
        const transitionRef = collection.doc(transitionKey);
        const issueRef = collection.doc(issueKey);
        const legacyTransitionRef = collection.doc(legacyTransitionKey);
        const legacyIssueRef = collection.doc(legacyIssueKey);
        const stableIssueQuery = collection.where('issueId', '==', input.event.issueId);
        const [
          transitionSnapshot,
          issueSnapshot,
          legacyTransitionSnapshot,
          legacyIssueSnapshot,
          stableIssueSnapshot,
        ] =
          await Promise.all([
            transaction.get(transitionRef),
            transaction.get(issueRef),
            transaction.get(legacyTransitionRef),
            transaction.get(legacyIssueRef),
            transaction.get(stableIssueQuery),
          ]);

        const transitionData = transitionSnapshot.exists
          ? transitionSnapshot.data() as Record<string, unknown>
          : undefined;
        const issueData = issueSnapshot.exists
          ? issueSnapshot.data() as Record<string, unknown>
          : undefined;
        const legacyTransitionData = legacyTransitionSnapshot.exists
          ? legacyTransitionSnapshot.data() as Record<string, unknown>
          : undefined;
        const rawLegacyIssueData = legacyIssueSnapshot.exists
          ? legacyIssueSnapshot.data() as Record<string, unknown>
          : undefined;
        const legacyIssueData = rawLegacyIssueData?.['issueId'] === input.event.issueId
          ? rawLegacyIssueData
          : undefined;
        const fallback = {
          receivedAt: input.receivedAt,
          proposedCodeTaskId: input.proposedCodeTaskId,
        };
        const directTransition = transitionData !== undefined
          ? toReservationView(transitionData, fallback)
          : undefined;
        const legacyTransition = legacyTransitionData !== undefined
          ? toReservationView(legacyTransitionData, fallback)
          : undefined;
        const stableEntries = stableIssueSnapshot.docs
          .map((snapshot) => ({
            id: snapshot.id,
            data: snapshot.data() as Record<string, unknown>,
          }))
          .filter((entry) => stableIdentityMatches(entry.data, input.event));
        const aliasedTransitionData = stableEntries.find(
          (entry) => entry.id !== issueKey && isSameTransitionData(entry.data, input.event)
        )?.data;
        const exactTransition = directTransition
          ?? (legacyTransition !== undefined && isSameLegacyTransition(legacyTransition, input.event)
            ? legacyTransition
            : aliasedTransitionData !== undefined
              ? toReservationView(aliasedTransitionData, fallback)
              : undefined);
        const stableIssueData = stableEntries
          .filter((entry) => entry.id !== transitionKey && !isSameTransitionData(entry.data, input.event))
          .sort((left, right) => {
            const score = (data: Record<string, unknown>): number => {
              const reservation = toReservationView(data, fallback);
              return (data['recordType'] === 'issue' ? 100 : 0)
                + (isLeaseActive(reservation, input.receivedAt) ? 50 : 0)
                + (reservation.codeTaskId !== undefined ? 25 : 0);
            };
            return score(right.data) - score(left.data);
          })[0]?.data;
        const issueReservation = issueData !== undefined
          ? toReservationView(issueData, fallback)
          : legacyIssueData !== undefined
            ? toReservationView(legacyIssueData, fallback)
            : stableIssueData !== undefined
              ? toReservationView(stableIssueData, fallback)
              : legacyTransition;

        const persistExisting = (
          key: string,
          recordType: 'transition' | 'issue',
          reservation: ReservationView,
          ownerTransitionKey = reservation.transitionKey ?? transitionKey
        ): void => {
          transaction.set(collection.doc(key), buildDoc({
            dedupeKey: key,
            transitionKey: ownerTransitionKey,
            recordType,
            reservation,
            event: input.event,
            latestReceivedAt: input.receivedAt,
            duplicateCount: reservation.duplicateCount + 1,
            payload,
            state: reservation.state,
            proposedCodeTaskId: reservation.proposedCodeTaskId,
            leaseToken: reservation.leaseToken,
            leaseExpiresAt: reservation.leaseExpiresAt,
            leaseOwner: reservation.leaseOwner,
            failureReason: reservation.failureReason,
            codeTaskId: reservation.codeTaskId,
            linearIssueId: reservation.linearIssueId,
          }));
        };

        if (exactTransition?.state === 'task_created') {
          persistExisting(transitionKey, 'transition', exactTransition);
          if (issueReservation === undefined) {
            persistExisting(issueKey, 'issue', exactTransition, transitionKey);
          }
          return ok({
            kind: 'duplicate' as const,
            ...(exactTransition.codeTaskId !== undefined && { codeTaskId: exactTransition.codeTaskId }),
          });
        }
        const sameLease = exactTransition?.leaseToken !== undefined
          && issueReservation?.leaseToken === exactTransition.leaseToken
          && (
            exactTransition.transitionKey === undefined
            || issueReservation.transitionKey === undefined
            || exactTransition.transitionKey === issueReservation.transitionKey
          );
        if (
          issueReservation !== undefined
          && isLeaseActive(issueReservation, input.receivedAt)
          && !sameLease
        ) {
          persistExisting(
            issueKey,
            'issue',
            issueReservation,
            issueReservation.transitionKey ?? transitionKey
          );
          return ok(issueReservation.codeTaskId === undefined
            ? { kind: 'retryable' as const }
            : { kind: 'duplicate' as const, codeTaskId: issueReservation.codeTaskId });
        }
        if (exactTransition !== undefined && isLeaseActive(exactTransition, input.receivedAt)) {
          persistExisting(transitionKey, 'transition', exactTransition);
          persistExisting(issueKey, 'issue', exactTransition, transitionKey);
          return ok(exactTransition.codeTaskId === undefined
            ? { kind: 'retryable' as const }
            : { kind: 'duplicate' as const, codeTaskId: exactTransition.codeTaskId });
        }

        const linkedCodeTaskId = issueReservation?.codeTaskId;
        const exactKnownTask = exactTransition?.codeTaskId;
        const linkedTaskBelongsToExactTransition =
          linkedCodeTaskId !== undefined && linkedCodeTaskId === exactKnownTask;
        if (
          issueReservation !== undefined
          && linkedCodeTaskId !== undefined
          && !linkedTaskBelongsToExactTransition
          && input.replaceLinkedCodeTaskId !== linkedCodeTaskId
        ) {
          persistExisting(issueKey, 'issue', issueReservation);
          return ok({
            kind: 'inspect_linked_task' as const,
            codeTaskId: linkedCodeTaskId,
            transitionKey,
            issueKey,
          });
        }
        const proposedCodeTaskId = exactTransition?.proposedCodeTaskId
          ?? (issueReservation?.state === 'reserved'
            ? issueReservation.proposedCodeTaskId
            : input.proposedCodeTaskId);
        const leaseToken = randomUUID();
        const leaseExpiresAt = new Date(input.receivedAt.getTime() + input.leaseDurationMs);
        const baseReservation: ReservationView = exactTransition ?? {
          transitionKey,
          state: 'reserved',
          receivedAt: input.receivedAt,
          duplicateCount: 0,
          proposedCodeTaskId,
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          leaseOwner: undefined,
          codeTaskId: undefined,
          linearIssueId: undefined,
          failureReason: undefined,
          eventId: input.event.eventId,
        };
        const linearIssueId = exactTransition?.linearIssueId ?? issueReservation?.linearIssueId;
        const reservedFields = {
          transitionKey,
          event: input.event,
          latestReceivedAt: input.receivedAt,
          payload,
          state: 'reserved' as const,
          proposedCodeTaskId,
          leaseToken,
          leaseExpiresAt,
          leaseOwner: input.leaseOwner,
          codeTaskId: exactKnownTask,
          linearIssueId,
        };
        transaction.set(transitionRef, buildDoc({
          dedupeKey: transitionKey,
          recordType: 'transition',
          reservation: baseReservation,
          duplicateCount: exactTransition === undefined ? 0 : exactTransition.duplicateCount + 1,
          ...reservedFields,
        }));
        transaction.set(issueRef, buildDoc({
          dedupeKey: issueKey,
          recordType: 'issue',
          reservation: issueReservation ?? baseReservation,
          duplicateCount: issueReservation === undefined ? 0 : issueReservation.duplicateCount + 1,
          ...reservedFields,
        }));
        return ok({
          kind: 'acquired' as const,
          transitionKey,
          issueKey,
          leaseToken,
          codeTaskId: proposedCodeTaskId,
          ...(linearIssueId !== undefined && { linearIssueId }),
        });
      });
    } catch (error) {
      logger.error({ error }, 'Failed to reserve Sentry issue event');
      return err(firestoreError(error));
    }
  }

  async function updateReservation(
    input: CompleteSentryTaskReservationInput | FailSentryTaskReservationInput,
    state: 'task_created' | 'failed'
  ): Promise<Result<void, SentryIssueEventRepositoryError>> {
    try {
      return await firestore.runTransaction(async (transaction) => {
        const transitionRef = collection.doc(input.transitionKey);
        const issueRef = collection.doc(input.issueKey);
        const [transitionSnapshot, issueSnapshot] = await Promise.all([
          transaction.get(transitionRef),
          transaction.get(issueRef),
        ]);
        if (!transitionSnapshot.exists || !issueSnapshot.exists) {
          return err({
            code: 'FIRESTORE_ERROR' as const,
            message: 'Sentry task reservation is missing',
          });
        }
        const transitionData = transitionSnapshot.data() as Record<string, unknown>;
        const issueData = issueSnapshot.data() as Record<string, unknown>;
        if (
          transitionData['state'] !== 'reserved'
          || issueData['state'] !== 'reserved'
          || transitionData['leaseToken'] !== input.leaseToken
          || issueData['leaseToken'] !== input.leaseToken
        ) {
          return err({
            code: 'FIRESTORE_ERROR' as const,
            message: 'Sentry task reservation lease is no longer owned by this delivery',
          });
        }

        const existingCodeTaskId = nonBlankString(transitionData['codeTaskId'])
          ?? nonBlankString(issueData['codeTaskId']);
        const codeTaskId = ('codeTaskId' in input ? input.codeTaskId : undefined)
          ?? existingCodeTaskId
          ?? null;
        const linearIssueId = input.linearIssueId
          ?? nonBlankString(transitionData['linearIssueId'])
          ?? nonBlankString(issueData['linearIssueId'])
          ?? null;
        const failureReason = state === 'failed' && 'reason' in input ? input.reason : null;
        const update = {
          state,
          leaseToken: null,
          leaseExpiresAt: null,
          leaseOwner: null,
          failureReason,
          codeTaskId,
          linearIssueId,
        };
        transaction.update(transitionRef, update);
        transaction.update(issueRef, update);
        return ok(undefined);
      });
    } catch (error) {
      logger.error({ error, input }, 'Failed to update Sentry task reservation');
      return err(firestoreError(error));
    }
  }

  async function checkpointLinearIssue(
    input: CheckpointSentryLinearIssueInput
  ): Promise<Result<void, SentryIssueEventRepositoryError>> {
    try {
      return await firestore.runTransaction(async (transaction) => {
        const transitionRef = collection.doc(input.transitionKey);
        const issueRef = collection.doc(input.issueKey);
        const [transitionSnapshot, issueSnapshot] = await Promise.all([
          transaction.get(transitionRef),
          transaction.get(issueRef),
        ]);
        if (!transitionSnapshot.exists || !issueSnapshot.exists) {
          return err({
            code: 'FIRESTORE_ERROR' as const,
            message: 'Sentry task reservation is missing',
          });
        }
        const transitionData = transitionSnapshot.data() as Record<string, unknown>;
        const issueData = issueSnapshot.data() as Record<string, unknown>;
        if (
          transitionData['state'] !== 'reserved'
          || issueData['state'] !== 'reserved'
          || transitionData['leaseToken'] !== input.leaseToken
          || issueData['leaseToken'] !== input.leaseToken
        ) {
          return err({
            code: 'FIRESTORE_ERROR' as const,
            message: 'Sentry task reservation lease is no longer owned by this delivery',
          });
        }
        transaction.update(transitionRef, { linearIssueId: input.linearIssueId });
        transaction.update(issueRef, { linearIssueId: input.linearIssueId });
        return ok(undefined);
      });
    } catch (error) {
      logger.error({ error, input }, 'Failed to checkpoint Sentry Linear issue');
      return err(firestoreError(error));
    }
  }

  return {
    acquire,
    checkpointLinearIssue,
    completeReservation: async (input) => await updateReservation(input, 'task_created'),
    failReservation: async (input) => await updateReservation(input, 'failed'),
  };
}
