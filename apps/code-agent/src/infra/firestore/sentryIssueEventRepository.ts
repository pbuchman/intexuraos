import { createHash } from 'node:crypto';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { Timestamp, type Firestore } from '@intexuraos/infra-firestore';
import type { Logger } from 'pino';
import type {
  NormalizedSentryIssueEvent,
  ReserveSentryIssueEventInput,
  ReserveSentryIssueEventResult,
  SentryIssueEventRecord,
} from '../../domain/models/sentryIssueEvent.js';
import type {
  SentryIssueEventRepository,
  SentryIssueEventRepositoryError,
} from '../../domain/repositories/sentryIssueEventRepository.js';

const COLLECTION_NAME = 'sentry-issue-events';

interface SentryIssueEventDoc {
  dedupeKey: string;
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
  payload: unknown;
  codeTaskId: string | null;
  linearIssueId: string | null;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  return new Date(String(value));
}

function nullToUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function toRecord(data: SentryIssueEventDoc): SentryIssueEventRecord {
  return {
    dedupeKey: data.dedupeKey,
    organizationSlug: data.organizationSlug,
    projectSlug: data.projectSlug,
    projectId: nullToUndefined(data.projectId),
    issueId: data.issueId,
    issueShortId: nullToUndefined(data.issueShortId),
    issueTitle: data.issueTitle,
    issueUrl: data.issueUrl,
    action: data.action,
    resource: data.resource,
    status: nullToUndefined(data.status),
    eventId: nullToUndefined(data.eventId),
    receivedAt: toDate(data.receivedAt),
    latestReceivedAt: toDate(data.latestReceivedAt),
    duplicateCount: data.duplicateCount,
    payload: data.payload,
    codeTaskId: nullToUndefined(data.codeTaskId),
    linearIssueId: nullToUndefined(data.linearIssueId),
  };
}

function toFirestoreDoc(input: {
  dedupeKey: string;
  event: NormalizedSentryIssueEvent;
  receivedAt: Date;
  latestReceivedAt: Date;
  duplicateCount: number;
  payload: unknown;
  codeTaskId?: string | undefined;
  linearIssueId?: string | undefined;
}): SentryIssueEventDoc {
  return {
    dedupeKey: input.dedupeKey,
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
    receivedAt: Timestamp.fromDate(input.receivedAt),
    latestReceivedAt: Timestamp.fromDate(input.latestReceivedAt),
    duplicateCount: input.duplicateCount,
    payload: input.payload,
    codeTaskId: input.codeTaskId ?? null,
    linearIssueId: input.linearIssueId ?? null,
  };
}

export function createSentryIssueDedupeKey(event: NormalizedSentryIssueEvent): string {
  const action = event.action.trim().toLowerCase() || 'unknown';
  return `sentry:${event.organizationSlug}:${event.projectSlug}:${event.issueId}:${event.resource}:${action}`;
}

function normalizeProblemTitle(title: string): string {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized === '' ? 'unknown' : normalized;
}

function getProblemProjectIdentity(event: NormalizedSentryIssueEvent): string {
  const projectId = event.projectId?.trim();
  if (projectId !== undefined && projectId !== '') return projectId;
  return event.projectSlug.trim();
}

export function createSentryProblemDedupeKey(event: NormalizedSentryIssueEvent): string {
  const projectIdentity = getProblemProjectIdentity(event);
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

export function createFirestoreSentryIssueEventRepository(deps: {
  firestore: Firestore;
  logger: Logger;
}): SentryIssueEventRepository {
  const { firestore, logger } = deps;
  const collection = firestore.collection(COLLECTION_NAME);

  async function reserveWithDedupeKey(
    input: ReserveSentryIssueEventInput,
    dedupeKey: string
  ): Promise<Result<ReserveSentryIssueEventResult, SentryIssueEventRepositoryError>> {
    try {
      return await firestore.runTransaction(async (transaction) => {
        const docRef = collection.doc(dedupeKey);
        const snapshot = await transaction.get(docRef);
        const payload = serializePayload(input.payload);
        if (!snapshot.exists) {
          const createdDoc = toFirestoreDoc({
            dedupeKey,
            event: input.event,
            receivedAt: input.receivedAt,
            latestReceivedAt: input.receivedAt,
            duplicateCount: 0,
            payload,
          });
          transaction.set(docRef, createdDoc);
          return ok({
            created: true,
            record: toRecord(createdDoc),
          });
        }

        const existing = snapshot.data() as SentryIssueEventDoc;
        const duplicateCount = (typeof existing.duplicateCount === 'number' ? existing.duplicateCount : 0) + 1;
        const merged: SentryIssueEventDoc = {
          ...existing,
          action: input.event.action,
          resource: input.event.resource,
          issueId: input.event.issueId,
          issueTitle: input.event.issueTitle,
          issueUrl: input.event.issueUrl,
          projectId: input.event.projectId ?? null,
          issueShortId: input.event.issueShortId ?? null,
          status: input.event.status ?? null,
          eventId: input.event.eventId ?? null,
          latestReceivedAt: Timestamp.fromDate(input.receivedAt),
          duplicateCount,
          payload,
        };
        transaction.update(docRef, {
          action: merged.action,
          resource: merged.resource,
          issueId: merged.issueId,
          issueTitle: merged.issueTitle,
          issueUrl: merged.issueUrl,
          projectId: merged.projectId,
          issueShortId: merged.issueShortId,
          status: merged.status,
          eventId: merged.eventId,
          latestReceivedAt: merged.latestReceivedAt,
          duplicateCount: merged.duplicateCount,
          payload: merged.payload,
        });
        return ok({
          created: false,
          record: toRecord(merged),
        });
      });
    } catch (error) {
      logger.error({ error }, 'Failed to reserve Sentry issue event');
      return err(firestoreError(error));
    }
  }

  return {
    reserve(
      input: ReserveSentryIssueEventInput
    ): Promise<Result<ReserveSentryIssueEventResult, SentryIssueEventRepositoryError>> {
      return reserveWithDedupeKey(input, createSentryIssueDedupeKey(input.event));
    },

    reserveTaskForProblem(
      input: ReserveSentryIssueEventInput
    ): Promise<Result<ReserveSentryIssueEventResult, SentryIssueEventRepositoryError>> {
      return reserveWithDedupeKey(input, createSentryProblemDedupeKey(input.event));
    },

    async markCodeTaskCreated(input): Promise<Result<SentryIssueEventRecord, SentryIssueEventRepositoryError>> {
      try {
        const docRef = collection.doc(input.dedupeKey);
        const snapshot = await docRef.get();
        if (!snapshot.exists) {
          return err({
            code: 'FIRESTORE_ERROR',
            message: `Missing Sentry issue event: ${input.dedupeKey}`,
          });
        }

        await docRef.update({
          codeTaskId: input.codeTaskId,
          linearIssueId: input.linearIssueId ?? null,
        });
        const updated = await docRef.get();
        return ok(toRecord(updated.data() as SentryIssueEventDoc));
      } catch (error) {
        logger.error({ error, input }, 'Failed to link Sentry issue event to code task');
        return err(firestoreError(error));
      }
    },
  };
}
