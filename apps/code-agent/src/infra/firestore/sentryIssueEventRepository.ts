import { createHash, randomUUID } from 'node:crypto';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { Timestamp, type Firestore } from '@intexuraos/infra-firestore';
import type { Logger } from 'pino';
import type {
  AcquireSentryTaskReservationInput,
  AcquireSentryTaskReservationResult,
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
  const projectId = event.projectId?.trim();
  return projectId !== undefined && projectId !== '' ? projectId : event.projectSlug;
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
  const projectIdentity = getProjectIdentity(event);
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
  const eventId = event.eventId?.trim();
  if (eventId === undefined || eventId === '') return true;
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
        const [transitionSnapshot, issueSnapshot, legacyTransitionSnapshot, legacyIssueSnapshot] =
          await Promise.all([
            transaction.get(transitionRef),
            transaction.get(issueRef),
            transaction.get(legacyTransitionRef),
            transaction.get(legacyIssueRef),
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
        const exactTransition = directTransition
          ?? (legacyTransition !== undefined && isSameLegacyTransition(legacyTransition, input.event)
            ? legacyTransition
            : undefined);
        const issueReservation = issueData !== undefined
          ? toReservationView(issueData, fallback)
          : legacyTransition
            ?? (legacyIssueData !== undefined ? toReservationView(legacyIssueData, fallback) : undefined);

        const persistExisting = (
          key: string,
          recordType: 'transition' | 'issue',
          reservation: ReservationView
        ): void => {
          transaction.set(collection.doc(key), buildDoc({
            dedupeKey: key,
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
          persistExisting(issueKey, 'issue', issueReservation ?? exactTransition);
          return ok({
            kind: 'duplicate' as const,
            ...(exactTransition.codeTaskId !== undefined && { codeTaskId: exactTransition.codeTaskId }),
          });
        }
        if (exactTransition !== undefined && isLeaseActive(exactTransition, input.receivedAt)) {
          persistExisting(transitionKey, 'transition', exactTransition);
          if (issueReservation !== undefined) persistExisting(issueKey, 'issue', issueReservation);
          return ok({
            kind: 'duplicate' as const,
            ...(exactTransition.codeTaskId !== undefined && { codeTaskId: exactTransition.codeTaskId }),
          });
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
        if (
          issueReservation !== undefined
          && isLeaseActive(issueReservation, input.receivedAt)
          && exactTransition === undefined
        ) {
          persistExisting(issueKey, 'issue', issueReservation);
          return ok({
            kind: 'duplicate' as const,
            ...(linkedCodeTaskId !== undefined && { codeTaskId: linkedCodeTaskId }),
          });
        }

        const proposedCodeTaskId = exactTransition?.proposedCodeTaskId
          ?? (issueReservation?.state === 'reserved'
            ? issueReservation.proposedCodeTaskId
            : input.proposedCodeTaskId);
        const leaseToken = randomUUID();
        const leaseExpiresAt = new Date(input.receivedAt.getTime() + input.leaseDurationMs);
        const baseReservation: ReservationView = exactTransition ?? {
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
        const reservedFields = {
          event: input.event,
          latestReceivedAt: input.receivedAt,
          payload,
          state: 'reserved' as const,
          proposedCodeTaskId,
          leaseToken,
          leaseExpiresAt,
          leaseOwner: input.leaseOwner,
          codeTaskId: exactKnownTask,
          linearIssueId: exactTransition?.linearIssueId,
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

        const codeTaskId = 'codeTaskId' in input
          ? input.codeTaskId ?? null
          : null;
        const linearIssueId = input.linearIssueId ?? null;
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

  return {
    acquire,
    completeReservation: async (input) => await updateReservation(input, 'task_created'),
    failReservation: async (input) => await updateReservation(input, 'failed'),
  };
}
