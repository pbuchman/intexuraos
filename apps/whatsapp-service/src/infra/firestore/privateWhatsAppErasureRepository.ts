import { createHash } from 'node:crypto';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import {
  FieldPath,
  Timestamp,
  computeExpireAt,
  getFirestore,
  type Query,
} from '@intexuraos/infra-firestore';
import {
  emptyPrivateWhatsAppErasureCounts,
  type PrivateWhatsAppErasureCounts,
  type PrivateWhatsAppErasureRequest,
  type PrivateWhatsAppErasureStage,
  type PrivateWhatsAppErasureStatus,
} from '../../domain/whatsapp/models/PrivateWhatsAppErasure.js';
import type { WhatsAppError } from '../../domain/whatsapp/models/error.js';
import type { PrivateMediaDeletionBatchResult } from '../../domain/whatsapp/ports/mediaStorage.js';
import type {
  AdvancePrivateWhatsAppErasureResult,
  CommitPrivateMediaErasureResult,
  PrivateWhatsAppErasureRepository,
  StartPrivateWhatsAppErasureResult,
} from '../../domain/whatsapp/ports/privateWhatsAppErasure.js';
import { WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION } from './conversationAssistantContextAttachmentRepository.js';
import {
  WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION,
  WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION,
} from './conversationAssistantRepository.js';
import { WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION } from './conversationAssistantTurnRequestRepository.js';
import {
  PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION,
  PRIVATE_WHATSAPP_CHATS_COLLECTION,
  PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION,
  PRIVATE_WHATSAPP_MESSAGES_COLLECTION,
  PRIVATE_WHATSAPP_SENDERS_COLLECTION,
  PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION,
} from './privateWhatsAppRepository.js';

export const PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION =
  'whatsapp_private_erasure_requests';

type FirestoreClient = ReturnType<typeof getFirestore>;
type FirestoreTransaction = Parameters<Parameters<FirestoreClient['runTransaction']>[0]>[0];

interface StoredPrivateWhatsAppErasureRequest extends PrivateWhatsAppErasureRequest {
  activeAssistantSessionId?: string;
  assistantSessionScanAfterId?: string;
  privateMediaCursor?: string;
  identityPseudonymized?: true;
  expireAt?: Timestamp;
}

type CountKey = keyof PrivateWhatsAppErasureCounts;

const COMPLETED_ERASURE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface DeletionStage {
  collectionName: string;
  field: string;
  value: string;
  countKey: CountKey;
  nextStage: PrivateWhatsAppErasureStage;
}

const ERASURE_STAGES = new Set<PrivateWhatsAppErasureStage>([
  'assistant_sessions',
  'assistant_turns',
  'assistant_transcript_chunks',
  'assistant_context_chunks',
  'assistant_context_attachments',
  'assistant_turn_requests',
  'source_context_changes',
  'source_messages',
  'source_chats',
  'source_senders',
  'source_sender_days',
  'private_media',
  'source_account',
  'completed',
]);

const ERASURE_STATUSES = new Set<PrivateWhatsAppErasureStatus>([
  'queued',
  'running',
  'completed',
  'failed',
]);

const COUNT_KEYS: CountKey[] = [
  'assistantSessions',
  'assistantTurns',
  'assistantTranscriptChunks',
  'assistantContextChunks',
  'assistantContextAttachments',
  'assistantTurnRequests',
  'sourceContextChanges',
  'sourceMessages',
  'sourceChats',
  'sourceSenders',
  'sourceSenderDays',
  'privateMediaObjects',
  'sourceAccounts',
];

export function createPrivateWhatsAppErasureRepository(): PrivateWhatsAppErasureRepository {
  return {
    start,
    get,
    advanceOneBatch,
    commitPrivateMediaBatch,
  };
}

async function start(input: {
  sourceAccountId: string;
  userId: string;
  erasureRequestId: string;
  now: string;
}): Promise<Result<StartPrivateWhatsAppErasureResult, WhatsAppError>> {
  try {
    const db = getFirestore();
    const requestRef = db
      .collection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION)
      .doc(input.erasureRequestId);
    const accountRef = db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(input.userId);
    const result = await db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      const accountSnapshot = await transaction.get(accountRef);
      if (requestSnapshot.exists) {
        const request = requireStoredRequest(
          requestSnapshot.id,
          requestSnapshot.data() as Record<string, unknown>
        );
        if (!storedIdentityMatches(request, input)) {
          return { status: 'conflict' as const };
        }
        return { status: 'existing' as const, request: toPublicRequest(request) };
      }
      if (!accountSnapshot.exists) return { status: 'not_found' as const };

      const account = accountSnapshot.data();
      if (
        account?.['userId'] !== input.userId ||
        account['sourceAccountId'] !== input.sourceAccountId
      ) {
        return { status: 'not_found' as const };
      }
      if (account['erasureStatus'] === 'erasing') {
        return { status: 'conflict' as const };
      }

      const accountGeneration = readAccountGeneration(account, input.sourceAccountId);
      const request: StoredPrivateWhatsAppErasureRequest = {
        erasureRequestId: input.erasureRequestId,
        userId: input.userId,
        sourceAccountId: input.sourceAccountId,
        accountGeneration,
        status: 'queued',
        stage: 'assistant_sessions',
        counts: emptyPrivateWhatsAppErasureCounts(),
        attempt: 0,
        createdAt: input.now,
        updatedAt: input.now,
      };
      transaction.set(requestRef, request);
      transaction.set(
        accountRef,
        {
          status: 'disabled',
          erasureStatus: 'erasing',
          erasureRequestId: input.erasureRequestId,
          generationId: accountGeneration,
          updatedAt: input.now,
        },
        { merge: true }
      );
      return { status: 'created' as const, request: toPublicRequest(request) };
    });
    return ok(result);
  } catch (error) {
    return persistenceError('start private WhatsApp erasure', error);
  }
}

async function get(input: {
  sourceAccountId: string;
  erasureRequestId: string;
}): Promise<Result<PrivateWhatsAppErasureRequest | null, WhatsAppError>> {
  try {
    const snapshot = await getFirestore()
      .collection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION)
      .doc(input.erasureRequestId)
      .get();
    if (!snapshot.exists) return ok(null);
    const request = requireStoredRequest(
      snapshot.id,
      snapshot.data() as Record<string, unknown>
    );
    if (!storedSourceAccountMatches(request, input.sourceAccountId)) {
      return ok(null);
    }
    return ok(toPublicRequest(request));
  } catch (error) {
    return persistenceError('load private WhatsApp erasure', error);
  }
}

async function advanceOneBatch(input: {
  sourceAccountId: string;
  userId: string;
  erasureRequestId: string;
  expectedAttempt: number;
  batchSize: number;
  now: string;
}): Promise<Result<AdvancePrivateWhatsAppErasureResult, WhatsAppError>> {
  try {
    const db = getFirestore();
    const requestRef = db
      .collection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION)
      .doc(input.erasureRequestId);
    const result = await db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) return { status: 'not_found' as const };
      const request = requireStoredRequest(
        requestSnapshot.id,
        requestSnapshot.data() as Record<string, unknown>
      );
      if (
        request.userId !== input.userId ||
        request.sourceAccountId !== input.sourceAccountId ||
        request.attempt !== input.expectedAttempt ||
        request.status === 'completed' ||
        request.status === 'failed'
      ) {
        return { status: 'stale' as const };
      }

      const advanced = await advanceStoredRequest(
        db,
        transaction,
        request,
        input.batchSize,
        input.now
      );
      if (advanced.resultStatus === 'private_media') {
        return {
          status: 'private_media' as const,
          request: toPublicRequest(advanced.request),
          ...(advanced.request.privateMediaCursor === undefined
            ? {}
            : { cursor: advanced.request.privateMediaCursor }),
        };
      }
      transaction.set(requestRef, toPersistedRequest(advanced.request));
      return {
        status: advanced.resultStatus,
        request: toPublicRequest(advanced.request),
      };
    });
    return ok(result);
  } catch (error) {
    return persistenceError('advance private WhatsApp erasure', error);
  }
}

async function commitPrivateMediaBatch(input: {
  sourceAccountId: string;
  userId: string;
  erasureRequestId: string;
  expectedAttempt: number;
  expectedCursor?: string;
  batch: PrivateMediaDeletionBatchResult;
  now: string;
}): Promise<Result<CommitPrivateMediaErasureResult, WhatsAppError>> {
  try {
    const db = getFirestore();
    const requestRef = db
      .collection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_COLLECTION)
      .doc(input.erasureRequestId);
    const result = await db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) return { status: 'not_found' as const };
      const request = requireStoredRequest(
        requestSnapshot.id,
        requestSnapshot.data() as Record<string, unknown>
      );
      if (
        request.userId !== input.userId ||
        request.sourceAccountId !== input.sourceAccountId ||
        request.attempt !== input.expectedAttempt ||
        request.status === 'completed' ||
        request.status === 'failed' ||
        request.stage !== 'private_media' ||
        request.privateMediaCursor !== input.expectedCursor
      ) {
        return { status: 'stale' as const };
      }

      if (!(await isAccountGenerationFenceValid(db, transaction, request))) {
        const failed = failedRequest(request, input.now, 'ACCOUNT_GENERATION_CHANGED');
        transaction.set(requestRef, failed);
        return { status: 'failed' as const, request: toPublicRequest(failed) };
      }

      const counts = incrementCount(
        request.counts,
        'privateMediaObjects',
        input.batch.deletedCount
      );
      const stage =
        input.batch.status === 'empty' && request.privateMediaCursor === undefined
          ? 'source_account'
          : 'private_media';
      const next = nextRunningRequest(request, input.now, { counts, stage });
      if (input.batch.status === 'advanced') {
        next.privateMediaCursor = input.batch.nextCursor;
      } else if (input.batch.status === 'empty') {
        Reflect.deleteProperty(next, 'privateMediaCursor');
      }
      transaction.set(requestRef, next);
      return { status: 'advanced' as const, request: toPublicRequest(next) };
    });
    return ok(result);
  } catch (error) {
    return persistenceError('commit private WhatsApp media erasure', error);
  }
}

async function advanceStoredRequest(
  db: FirestoreClient,
  transaction: FirestoreTransaction,
  request: StoredPrivateWhatsAppErasureRequest,
  batchSize: number,
  now: string
): Promise<{
  resultStatus: 'advanced' | 'private_media' | 'completed' | 'failed';
  request: StoredPrivateWhatsAppErasureRequest;
}> {
  if (request.stage === 'assistant_sessions') {
    return await advanceAssistantSession(db, transaction, request, batchSize, now);
  }
  if (request.stage === 'source_account') {
    return await completeSourceAccount(db, transaction, request, now);
  }
  if (request.stage === 'private_media') {
    if (!(await isAccountGenerationFenceValid(db, transaction, request))) {
      return {
        resultStatus: 'failed',
        request: failedRequest(request, now, 'ACCOUNT_GENERATION_CHANGED'),
      };
    }
    return { resultStatus: 'private_media', request };
  }

  if (request.stage === 'completed') {
    throw new Error('Invalid stored erasure request: completed stage is not runnable');
  }
  const stage = getDeletionStage(
    request.stage,
    request.activeAssistantSessionId,
    request.sourceAccountId
  );
  const query = db
    .collection(stage.collectionName)
    .where(stage.field, '==', stage.value)
    .limit(batchSize);
  const snapshot = await transaction.get(query);
  for (const document of snapshot.docs) {
    transaction.delete(document.ref);
  }
  const counts = incrementCount(request.counts, stage.countKey, snapshot.docs.length);
  const nextStage = snapshot.docs.length === 0 ? stage.nextStage : request.stage;
  return {
    resultStatus: 'advanced',
    request: nextRunningRequest(request, now, { counts, stage: nextStage }),
  };
}

async function advanceAssistantSession(
  db: FirestoreClient,
  transaction: FirestoreTransaction,
  request: StoredPrivateWhatsAppErasureRequest,
  batchSize: number,
  now: string
): Promise<{
  resultStatus: 'advanced' | 'failed';
  request: StoredPrivateWhatsAppErasureRequest;
}> {
  if (request.activeAssistantSessionId !== undefined) {
    const sessionRef = db
      .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
      .doc(request.activeAssistantSessionId);
    const sessionSnapshot = await transaction.get(sessionRef);
    let deleted = 0;
    if (
      sessionSnapshot.exists &&
      (await isAssistantSessionOwnedByErasure(
        db,
        transaction,
        sessionSnapshot.data() as Record<string, unknown>,
        request
      ))
    ) {
      transaction.delete(sessionRef);
      deleted = 1;
    }
    const next = nextRunningRequest(request, now, {
      counts: incrementCount(request.counts, 'assistantSessions', deleted),
      stage: 'assistant_sessions',
    });
    Reflect.deleteProperty(next, 'activeAssistantSessionId');
    return { resultStatus: 'advanced', request: next };
  }

  let query: Query = db
    .collection(WHATSAPP_CONVERSATION_ASSISTANT_SESSIONS_COLLECTION)
    .where('userId', '==', request.userId)
    .orderBy(FieldPath.documentId(), 'asc')
    .limit(batchSize);
  if (request.assistantSessionScanAfterId !== undefined) {
    query = query.startAfter(request.assistantSessionScanAfterId);
  }
  const snapshot = await transaction.get(query);
  for (const session of snapshot.docs) {
    if (
      await isAssistantSessionOwnedByErasure(
        db,
        transaction,
        session.data() as Record<string, unknown>,
        request
      )
    ) {
      transaction.set(
        session.ref,
        { deletionStartedAt: now, accountErasureRequestId: request.erasureRequestId },
        { merge: true }
      );
      return {
        resultStatus: 'advanced',
        request: nextRunningRequest(request, now, {
          stage: 'assistant_turns',
          activeAssistantSessionId: session.id,
          assistantSessionScanAfterId: session.id,
        }),
      };
    }
  }

  const lastScannedSessionId = snapshot.docs.at(-1)?.id;
  if (snapshot.docs.length === batchSize && lastScannedSessionId !== undefined) {
    return {
      resultStatus: 'advanced',
      request: nextRunningRequest(request, now, {
        stage: 'assistant_sessions',
        assistantSessionScanAfterId: lastScannedSessionId,
      }),
    };
  }
  const next = nextRunningRequest(request, now, { stage: 'source_context_changes' });
  Reflect.deleteProperty(next, 'assistantSessionScanAfterId');
  return { resultStatus: 'advanced', request: next };
}

async function isAssistantSessionOwnedByErasure(
  db: FirestoreClient,
  transaction: FirestoreTransaction,
  sessionData: Record<string, unknown>,
  request: StoredPrivateWhatsAppErasureRequest
): Promise<boolean> {
  if (sessionData['userId'] !== request.userId) return false;
  const directSourceAccountId = sessionData['sourceAccountId'];
  if (directSourceAccountId !== undefined) {
    if (directSourceAccountId !== request.sourceAccountId) return false;
    const directSourceAccountGeneration = sessionData['sourceAccountGeneration'];
    return (
      directSourceAccountGeneration === undefined ||
      directSourceAccountGeneration === request.accountGeneration
    );
  }
  const continuationSourceAccountId = readContinuationSourceAccountId(sessionData);
  if (continuationSourceAccountId !== null) {
    return continuationSourceAccountId === request.sourceAccountId;
  }
  const chatId = sessionData['chatId'];
  if (typeof chatId !== 'string' || chatId.length === 0) return false;
  const chatSnapshot = await transaction.get(
    db.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(chatId)
  );
  return (
    chatSnapshot.exists &&
    chatSnapshot.data()?.['userId'] === request.userId &&
    chatSnapshot.data()?.['sourceAccountId'] === request.sourceAccountId
  );
}

async function completeSourceAccount(
  db: FirestoreClient,
  transaction: FirestoreTransaction,
  request: StoredPrivateWhatsAppErasureRequest,
  now: string
): Promise<{
  resultStatus: 'completed' | 'failed';
  request: StoredPrivateWhatsAppErasureRequest;
}> {
  const accountRef = db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(request.userId);
  const accountSnapshot = await transaction.get(accountRef);
  if (!accountSnapshot.exists) {
    return { resultStatus: 'completed', request: completedRequest(request, now, 0) };
  }
  const account = accountSnapshot.data();
  if (
    account?.['userId'] !== request.userId ||
    account['sourceAccountId'] !== request.sourceAccountId ||
    readAccountGeneration(account, request.sourceAccountId) !== request.accountGeneration ||
    account['erasureRequestId'] !== request.erasureRequestId ||
    account['erasureStatus'] !== 'erasing'
  ) {
    return {
      resultStatus: 'failed',
      request: failedRequest(request, now, 'ACCOUNT_GENERATION_CHANGED'),
    };
  }
  transaction.delete(accountRef);
  return { resultStatus: 'completed', request: completedRequest(request, now, 1) };
}

async function isAccountGenerationFenceValid(
  db: FirestoreClient,
  transaction: FirestoreTransaction,
  request: StoredPrivateWhatsAppErasureRequest
): Promise<boolean> {
  const snapshot = await transaction.get(
    db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(request.userId)
  );
  if (!snapshot.exists) return true;
  const account = snapshot.data();
  return (
    account?.['userId'] === request.userId &&
    account['sourceAccountId'] === request.sourceAccountId &&
    readAccountGeneration(account, request.sourceAccountId) === request.accountGeneration &&
    account['erasureRequestId'] === request.erasureRequestId &&
    account['erasureStatus'] === 'erasing'
  );
}

function getDeletionStage(
  stage: Exclude<
    PrivateWhatsAppErasureStage,
    'assistant_sessions' | 'private_media' | 'source_account' | 'completed'
  >,
  activeAssistantSessionId: string | undefined,
  sourceAccountId: string
): {
  collectionName: string;
  field: string;
  value: string;
  countKey: CountKey;
  nextStage: PrivateWhatsAppErasureStage;
} {
  switch (stage) {
    case 'assistant_turns':
      return assistantDeletionStage(
        WHATSAPP_CONVERSATION_ASSISTANT_TURNS_COLLECTION,
        activeAssistantSessionId,
        'assistantTurns',
        'assistant_transcript_chunks'
      );
    case 'assistant_transcript_chunks':
      return assistantDeletionStage(
        WHATSAPP_CONVERSATION_ASSISTANT_TRANSCRIPT_CHUNKS_COLLECTION,
        activeAssistantSessionId,
        'assistantTranscriptChunks',
        'assistant_context_chunks'
      );
    case 'assistant_context_chunks':
      return assistantDeletionStage(
        WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_CHUNKS_COLLECTION,
        activeAssistantSessionId,
        'assistantContextChunks',
        'assistant_context_attachments'
      );
    case 'assistant_context_attachments':
      return assistantDeletionStage(
        WHATSAPP_CONVERSATION_ASSISTANT_CONTEXT_ATTACHMENTS_COLLECTION,
        activeAssistantSessionId,
        'assistantContextAttachments',
        'assistant_turn_requests'
      );
    case 'assistant_turn_requests':
      return assistantDeletionStage(
        WHATSAPP_CONVERSATION_ASSISTANT_TURN_REQUESTS_COLLECTION,
        activeAssistantSessionId,
        'assistantTurnRequests',
        'assistant_sessions'
      );
    case 'source_context_changes':
      return sourceDeletionStage(
        PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION,
        sourceAccountId,
        'sourceContextChanges',
        'source_messages'
      );
    case 'source_messages':
      return sourceDeletionStage(
        PRIVATE_WHATSAPP_MESSAGES_COLLECTION,
        sourceAccountId,
        'sourceMessages',
        'source_chats'
      );
    case 'source_chats':
      return sourceDeletionStage(
        PRIVATE_WHATSAPP_CHATS_COLLECTION,
        sourceAccountId,
        'sourceChats',
        'source_senders'
      );
    case 'source_senders':
      return sourceDeletionStage(
        PRIVATE_WHATSAPP_SENDERS_COLLECTION,
        sourceAccountId,
        'sourceSenders',
        'source_sender_days'
      );
    case 'source_sender_days':
      return sourceDeletionStage(
        PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION,
        sourceAccountId,
        'sourceSenderDays',
        'private_media'
      );
  }
}

function assistantDeletionStage(
  collectionName: string,
  activeAssistantSessionId: string | undefined,
  countKey: CountKey,
  nextStage: PrivateWhatsAppErasureStage
): DeletionStage {
  if (activeAssistantSessionId === undefined) {
    throw new Error('Invalid stored erasure request: assistant session target is missing');
  }
  return {
    collectionName,
    field: 'sessionId',
    value: activeAssistantSessionId,
    countKey,
    nextStage,
  };
}

function sourceDeletionStage(
  collectionName: string,
  sourceAccountId: string,
  countKey: CountKey,
  nextStage: PrivateWhatsAppErasureStage
): DeletionStage {
  return {
    collectionName,
    field: 'sourceAccountId',
    value: sourceAccountId,
    countKey,
    nextStage,
  };
}

function nextRunningRequest(
  request: StoredPrivateWhatsAppErasureRequest,
  now: string,
  changes: {
    counts?: PrivateWhatsAppErasureCounts;
    stage: PrivateWhatsAppErasureStage;
    activeAssistantSessionId?: string;
    assistantSessionScanAfterId?: string;
  }
): StoredPrivateWhatsAppErasureRequest {
  return {
    ...request,
    status: 'running',
    stage: changes.stage,
    counts: changes.counts ?? request.counts,
    attempt: request.attempt + 1,
    updatedAt: now,
    ...(changes.activeAssistantSessionId === undefined
      ? {}
      : { activeAssistantSessionId: changes.activeAssistantSessionId }),
    ...(changes.assistantSessionScanAfterId === undefined
      ? {}
      : { assistantSessionScanAfterId: changes.assistantSessionScanAfterId }),
  };
}

function completedRequest(
  request: StoredPrivateWhatsAppErasureRequest,
  now: string,
  deletedAccounts: number
): StoredPrivateWhatsAppErasureRequest {
  const completed: StoredPrivateWhatsAppErasureRequest = {
    ...request,
    status: 'completed',
    stage: 'completed',
    counts: incrementCount(request.counts, 'sourceAccounts', deletedAccounts),
    attempt: request.attempt + 1,
    updatedAt: now,
    completedAt: now,
  };
  Reflect.deleteProperty(completed, 'activeAssistantSessionId');
  Reflect.deleteProperty(completed, 'assistantSessionScanAfterId');
  Reflect.deleteProperty(completed, 'privateMediaCursor');
  return completed;
}

function failedRequest(
  request: StoredPrivateWhatsAppErasureRequest,
  now: string,
  failureCode: NonNullable<PrivateWhatsAppErasureRequest['failureCode']>
): StoredPrivateWhatsAppErasureRequest {
  const failed: StoredPrivateWhatsAppErasureRequest = {
    ...request,
    status: 'failed',
    attempt: request.attempt + 1,
    updatedAt: now,
    failureCode,
  };
  Reflect.deleteProperty(failed, 'activeAssistantSessionId');
  Reflect.deleteProperty(failed, 'assistantSessionScanAfterId');
  Reflect.deleteProperty(failed, 'privateMediaCursor');
  return failed;
}

function incrementCount(
  counts: PrivateWhatsAppErasureCounts,
  key: CountKey,
  increment: number
): PrivateWhatsAppErasureCounts {
  return { ...counts, [key]: counts[key] + increment };
}

function readContinuationSourceAccountId(data: Record<string, unknown> | undefined): string | null {
  const continuation = data?.['continuation'];
  if (continuation === null || typeof continuation !== 'object') return null;
  const sourceAccountId = (continuation as Record<string, unknown>)['sourceAccountId'];
  return typeof sourceAccountId === 'string' ? sourceAccountId : null;
}

function readAccountGeneration(
  account: Record<string, unknown>,
  sourceAccountId: string
): string {
  const generationId = account['generationId'];
  return typeof generationId === 'string' && generationId.length > 0
    ? generationId
    : sourceAccountId;
}

function pseudonymizeErasureIdentifier(
  erasureRequestId: string,
  kind: 'request' | 'user' | 'source_account' | 'account_generation',
  value: string
): string {
  return `sha256:${createHash('sha256')
    .update(`private-whatsapp-erasure\0${erasureRequestId}\0${kind}\0${value}`)
    .digest('hex')}`;
}

function storedSourceAccountMatches(
  request: StoredPrivateWhatsAppErasureRequest,
  sourceAccountId: string
): boolean {
  if (request.identityPseudonymized !== true) {
    return request.sourceAccountId === sourceAccountId;
  }
  return (
    request.sourceAccountId ===
    pseudonymizeErasureIdentifier(
      request.erasureRequestId,
      'source_account',
      sourceAccountId
    )
  );
}

function storedIdentityMatches(
  request: StoredPrivateWhatsAppErasureRequest,
  input: { userId: string; sourceAccountId: string }
): boolean {
  if (!storedSourceAccountMatches(request, input.sourceAccountId)) return false;
  if (request.identityPseudonymized !== true) return request.userId === input.userId;
  return (
    request.userId ===
    pseudonymizeErasureIdentifier(request.erasureRequestId, 'user', input.userId)
  );
}

function toPersistedRequest(
  request: StoredPrivateWhatsAppErasureRequest
): StoredPrivateWhatsAppErasureRequest {
  if (request.status !== 'completed') return request;
  return {
    ...request,
    erasureRequestId: pseudonymizeErasureIdentifier(
      request.erasureRequestId,
      'request',
      request.erasureRequestId
    ),
    userId: pseudonymizeErasureIdentifier(request.erasureRequestId, 'user', request.userId),
    sourceAccountId: pseudonymizeErasureIdentifier(
      request.erasureRequestId,
      'source_account',
      request.sourceAccountId
    ),
    accountGeneration: pseudonymizeErasureIdentifier(
      request.erasureRequestId,
      'account_generation',
      request.accountGeneration
    ),
    identityPseudonymized: true,
    expireAt: computeExpireAt(
      COMPLETED_ERASURE_RETENTION_MS,
      new Date(request.updatedAt)
    ),
  };
}

function toPublicRequest(
  request: StoredPrivateWhatsAppErasureRequest
): PrivateWhatsAppErasureRequest {
  const projected: PrivateWhatsAppErasureRequest = {
    erasureRequestId: request.erasureRequestId,
    userId: request.userId,
    sourceAccountId: request.sourceAccountId,
    accountGeneration: request.accountGeneration,
    status: request.status,
    stage: request.stage,
    counts: { ...request.counts },
    attempt: request.attempt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
  if (request.completedAt !== undefined) projected.completedAt = request.completedAt;
  if (request.failureCode !== undefined) projected.failureCode = request.failureCode;
  return projected;
}

function requireStoredRequest(
  id: string,
  data: Record<string, unknown>
): StoredPrivateWhatsAppErasureRequest {
  const status = data['status'];
  const stage = data['stage'];
  const counts = data['counts'];
  const identityPseudonymized = data['identityPseudonymized'] === true;
  const expectedStoredRequestId = identityPseudonymized
    ? pseudonymizeErasureIdentifier(id, 'request', id)
    : id;
  if (
    data['erasureRequestId'] !== expectedStoredRequestId ||
    typeof data['userId'] !== 'string' ||
    typeof data['sourceAccountId'] !== 'string' ||
    typeof data['accountGeneration'] !== 'string' ||
    typeof status !== 'string' ||
    !ERASURE_STATUSES.has(status as PrivateWhatsAppErasureStatus) ||
    typeof stage !== 'string' ||
    !ERASURE_STAGES.has(stage as PrivateWhatsAppErasureStage) ||
    counts === null ||
    typeof counts !== 'object' ||
    COUNT_KEYS.some(
      (key) =>
        typeof (counts as Record<string, unknown>)[key] !== 'number' ||
        !Number.isInteger((counts as Record<string, unknown>)[key]) ||
        ((counts as Record<string, unknown>)[key] as number) < 0
    ) ||
    typeof data['attempt'] !== 'number' ||
    !Number.isInteger(data['attempt']) ||
    data['attempt'] < 0 ||
    typeof data['createdAt'] !== 'string' ||
    typeof data['updatedAt'] !== 'string' ||
    (data['privateMediaCursor'] !== undefined &&
      typeof data['privateMediaCursor'] !== 'string') ||
    (data['identityPseudonymized'] !== undefined && !identityPseudonymized) ||
    (identityPseudonymized &&
      (status !== 'completed' ||
        stage !== 'completed' ||
        !(data['expireAt'] instanceof Timestamp)))
  ) {
    throw new Error('Invalid stored private WhatsApp erasure request');
  }
  const request: StoredPrivateWhatsAppErasureRequest = {
    erasureRequestId: id,
    userId: data['userId'],
    sourceAccountId: data['sourceAccountId'],
    accountGeneration: data['accountGeneration'],
    status: status as PrivateWhatsAppErasureStatus,
    stage: stage as PrivateWhatsAppErasureStage,
    counts: { ...(counts as unknown as PrivateWhatsAppErasureCounts) },
    attempt: data['attempt'],
    createdAt: data['createdAt'],
    updatedAt: data['updatedAt'],
  };
  if (typeof data['completedAt'] === 'string') request.completedAt = data['completedAt'];
  if (
    data['failureCode'] === 'ACCOUNT_GENERATION_CHANGED' ||
    data['failureCode'] === 'INVALID_STORED_REQUEST'
  ) {
    request.failureCode = data['failureCode'];
  }
  if (typeof data['activeAssistantSessionId'] === 'string') {
    request.activeAssistantSessionId = data['activeAssistantSessionId'];
  }
  if (typeof data['assistantSessionScanAfterId'] === 'string') {
    request.assistantSessionScanAfterId = data['assistantSessionScanAfterId'];
  }
  if (typeof data['privateMediaCursor'] === 'string') {
    request.privateMediaCursor = data['privateMediaCursor'];
  }
  if (identityPseudonymized) {
    request.identityPseudonymized = true;
    request.expireAt = data['expireAt'] as Timestamp;
  }
  return request;
}

function persistenceError<T>(operation: string, error: unknown): Result<T, WhatsAppError> {
  return err({
    code: 'PERSISTENCE_ERROR',
    message: `Failed to ${operation}: ${getErrorMessage(error, 'Unknown Firestore error')}`,
  });
}
