import { err, ok, type Result } from '@intexuraos/common-core';
import {
  FieldPath,
  getFirestore,
  type Query,
  type QueryDocumentSnapshot,
} from '@intexuraos/infra-firestore';
import type {
  PrivateDigestSourceError,
  PrivateDigestSourcePosition,
  QueryPrivateDigestMessagesInput,
} from '../../domain/whatsapp/models/PrivateWhatsAppDigestSource.js';
import type {
  PrivateWhatsAppAccount,
  PrivateWhatsAppChat,
  PrivateWhatsAppMessage,
} from '../../domain/whatsapp/models/PrivateWhatsApp.js';
import type { PrivateWhatsAppContextChange } from '../../domain/whatsapp/models/PrivateWhatsAppContextJournal.js';
import type {
  PrivateDigestSourceCursorClaims,
  PrivateDigestSourceRawPage,
  PrivateDigestSourceRouteBinding,
  PrivateDigestSourceTokenCodec,
  PrivateWhatsAppDigestSourceRepository,
} from '../../domain/whatsapp/ports/privateWhatsAppDigestSourceRepository.js';
import {
  PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION,
  PRIVATE_WHATSAPP_CHATS_COLLECTION,
  PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION,
  PRIVATE_WHATSAPP_MESSAGES_COLLECTION,
} from './privateWhatsAppRepository.js';

const MAX_PAGE_SIZE = 200;
const MAX_JOURNAL_CHANGES_PER_PAGE = 400;

type FirestoreClient = ReturnType<typeof getFirestore>;
type FirestoreTransaction = Parameters<Parameters<FirestoreClient['runTransaction']>[0]>[0];

interface RepositoryDeps {
  tokens: PrivateDigestSourceTokenCodec;
}

interface TransactionPage {
  messages: PrivateWhatsAppMessage[];
  watermark: PrivateDigestSourcePosition | null;
  currentContextSequence: number;
  hasMore: boolean;
  lastPosition: PrivateDigestSourcePosition | null;
}

type TransactionOutcome =
  | { status: 'page'; page: TransactionPage }
  | { status: 'not_found'; target: 'source' | 'chat' }
  | { status: 'source_changed' };

export function createPrivateWhatsAppDigestSourceRepository(
  deps: RepositoryDeps
): PrivateWhatsAppDigestSourceRepository {
  return {
    async queryMessages(
      input: QueryPrivateDigestMessagesInput
    ): Promise<Result<PrivateDigestSourceRawPage, PrivateDigestSourceError>> {
      const validatedInput = validateInput(input);
      if (!validatedInput.ok) return validatedInput;
      const binding = toBinding(input, validatedInput.value);
      const cursorResult = readCursor(input.cursor, binding, deps.tokens);
      if (!cursorResult.ok) return cursorResult;
      const cursor = cursorResult.value;

      try {
        const transactionOutcome = await readTransactionPage(
          input,
          validatedInput.value,
          cursor,
          binding
        );
        if (transactionOutcome.status === 'not_found') {
          return transactionOutcome.target === 'source'
            ? privateSourceNotFound()
            : privateChatNotFound();
        }
        if (transactionOutcome.status === 'source_changed') return sourceChanged();

        return buildRawPage(binding, cursor, transactionOutcome.page, deps.tokens);
      } catch {
        return err({
          code: 'PERSISTENCE_ERROR',
          message: 'Failed to query private WhatsApp digest source',
        });
      }
    },
  };
}

function validateInput(
  input: QueryPrivateDigestMessagesInput
): Result<{ windowStart: string; windowEnd: string }, PrivateDigestSourceError> {
  const windowStart = normalizeIsoTimestamp(input.windowStart);
  const windowEnd = normalizeIsoTimestamp(input.windowEnd);
  if (
    input.userId.trim().length === 0 ||
    input.sourceAccountId.trim().length === 0 ||
    input.generationId.trim().length === 0 ||
    input.chatId.trim().length === 0 ||
    windowStart === undefined ||
    windowEnd === undefined ||
    Date.parse(windowStart) >= Date.parse(windowEnd) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_PAGE_SIZE ||
    input.cursor?.length === 0
  ) {
    return err({ code: 'VALIDATION_ERROR', message: 'Invalid private digest source query' });
  }
  return ok({ windowStart, windowEnd });
}

function toBinding(
  input: QueryPrivateDigestMessagesInput,
  window: { windowStart: string; windowEnd: string }
): PrivateDigestSourceRouteBinding {
  return {
    userId: input.userId,
    sourceAccountId: input.sourceAccountId,
    generationId: input.generationId,
    chatId: input.chatId,
    chatType: input.chatType,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
  };
}

function readCursor(
  token: string | undefined,
  binding: PrivateDigestSourceRouteBinding,
  tokens: PrivateDigestSourceTokenCodec
): Result<PrivateDigestSourceCursorClaims | null, PrivateDigestSourceError> {
  if (token === undefined) return ok(null);
  const decoded = tokens.readCursor({ token, binding });
  if (!decoded.ok) return decoded;
  if (!isValidCursorClaims(decoded.value, binding)) return sourceChanged();
  return ok(decoded.value);
}

async function readTransactionPage(
  input: QueryPrivateDigestMessagesInput,
  window: { windowStart: string; windowEnd: string },
  cursor: PrivateDigestSourceCursorClaims | null,
  binding: PrivateDigestSourceRouteBinding
): Promise<TransactionOutcome> {
  const db = getFirestore();
  return await db.runTransaction(async (transaction): Promise<TransactionOutcome> => {
    const accountSnapshot = await transaction.get(
      db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(input.userId)
    );
    if (!accountSnapshot.exists) return { status: 'not_found', target: 'source' };
    const account = accountSnapshot.data() as PrivateWhatsAppAccount;
    if (
      account.userId !== input.userId ||
      account.sourceAccountId !== input.sourceAccountId ||
      account.status !== 'active' ||
      account.erasureStatus === 'erasing'
    ) {
      return { status: 'not_found', target: 'source' };
    }
    const currentGenerationId =
      typeof account.generationId === 'string' && account.generationId.length > 0
        ? account.generationId
        : account.sourceAccountId;
    if (currentGenerationId !== input.generationId) return { status: 'source_changed' };

    const chatSnapshot = await transaction.get(
      db.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(input.chatId)
    );
    if (!chatSnapshot.exists) return { status: 'not_found', target: 'chat' };
    const chat = chatSnapshot.data() as PrivateWhatsAppChat;
    if (
      chat.userId !== input.userId ||
      chat.sourceAccountId !== input.sourceAccountId ||
      chatSnapshot.id !== input.chatId
    ) {
      return { status: 'not_found', target: 'chat' };
    }
    if (chat.chatType !== input.chatType) return { status: 'source_changed' };
    const currentContextSequence = contextSequence(chat.contextChangeSequence);
    if (currentContextSequence === undefined) return { status: 'source_changed' };

    const queriedWatermark =
      cursor === null
        ? await readHighWatermark(transaction, binding, window.windowStart, window.windowEnd)
        : cursor.watermark;
    if (queriedWatermark === undefined) return { status: 'source_changed' };
    const watermark = queriedWatermark;
    if (watermark === null) {
      return {
        status: 'page',
        page: {
          messages: [],
          watermark: null,
          currentContextSequence,
          hasMore: false,
          lastPosition: null,
        },
      };
    }

    if (
      cursor !== null &&
      !(await journalStillValid(
        transaction,
        binding,
        cursor.validatedContextSequence,
        currentContextSequence,
        watermark,
        window.windowStart,
        window.windowEnd
      ))
    ) {
      return { status: 'source_changed' };
    }

    const page = await readMessagePage(
      transaction,
      binding,
      window.windowStart,
      window.windowEnd,
      watermark,
      cursor?.position,
      input.limit
    );
    if (page === undefined) return { status: 'source_changed' };
    return {
      status: 'page',
      page: { ...page, watermark, currentContextSequence },
    };
  });
}

async function readHighWatermark(
  transaction: FirestoreTransaction,
  binding: PrivateDigestSourceRouteBinding,
  windowStart: string,
  windowEnd: string
): Promise<PrivateDigestSourcePosition | null | undefined> {
  const db = getFirestore();
  const query = ownedWindowQuery(db, binding, windowStart, windowEnd)
    .orderBy('eventTimestamp', 'desc')
    .orderBy(FieldPath.documentId(), 'desc')
    .limit(1);
  const snapshot = await transaction.get(query);
  const first = snapshot.docs[0];
  if (first === undefined) return null;
  return isOwnedMessageSnapshot(first, binding) ? positionFromSnapshot(first) : undefined;
}

async function readMessagePage(
  transaction: FirestoreTransaction,
  binding: PrivateDigestSourceRouteBinding,
  windowStart: string,
  windowEnd: string,
  watermark: PrivateDigestSourcePosition,
  position: PrivateDigestSourcePosition | undefined,
  limit: number
): Promise<
  | {
      messages: PrivateWhatsAppMessage[];
      hasMore: boolean;
      lastPosition: PrivateDigestSourcePosition | null;
    }
  | undefined
> {
  const db = getFirestore();
  let query = ownedWindowQuery(db, binding, windowStart, windowEnd)
    .where('eventTimestamp', '<=', watermark.eventTimestamp)
    .orderBy('eventTimestamp', 'asc')
    .orderBy(FieldPath.documentId(), 'asc');
  if (position !== undefined) {
    query = query.startAfter(position.eventTimestamp, position.messageId);
  }
  const snapshot = await transaction.get(query.limit(limit + 1));
  const boundedDocs = snapshot.docs.filter(
    (doc) => comparePosition(positionFromSnapshot(doc), watermark) <= 0
  );
  if (boundedDocs.some((doc) => !isOwnedMessageSnapshot(doc, binding))) return undefined;
  const pageDocs = boundedDocs.slice(0, limit);
  const lastDoc = pageDocs[pageDocs.length - 1];
  return {
    messages: pageDocs.map(toPrivateWhatsAppMessage),
    hasMore: boundedDocs.length > limit,
    lastPosition: lastDoc === undefined ? null : positionFromSnapshot(lastDoc),
  };
}

async function journalStillValid(
  transaction: FirestoreTransaction,
  binding: PrivateDigestSourceRouteBinding,
  validatedSequence: number,
  currentSequence: number,
  watermark: PrivateDigestSourcePosition,
  windowStart: string,
  windowEnd: string
): Promise<boolean> {
  if (
    !Number.isInteger(validatedSequence) ||
    validatedSequence < 0 ||
    currentSequence < validatedSequence
  ) {
    return false;
  }
  const changeCount = currentSequence - validatedSequence;
  if (changeCount === 0) return true;
  if (changeCount > MAX_JOURNAL_CHANGES_PER_PAGE) return false;

  const snapshot = await transaction.get(
    getFirestore()
      .collection(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)
      .where('sourceAccountId', '==', binding.sourceAccountId)
      .where('chatId', '==', binding.chatId)
      .where('sequence', '>', validatedSequence)
      .where('sequence', '<=', currentSequence)
      .orderBy('sequence', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(changeCount)
  );
  if (snapshot.docs.length !== changeCount) return false;

  for (let index = 0; index < snapshot.docs.length; index += 1) {
    const entry = snapshot.docs[index]?.data() as PrivateWhatsAppContextChange | undefined;
    if (
      entry?.sequence !== validatedSequence + index + 1 ||
      entry.userId !== binding.userId ||
      entry.sourceAccountId !== binding.sourceAccountId ||
      entry.chatId !== binding.chatId ||
      typeof entry.messageId !== 'string' ||
      normalizeIsoTimestamp(entry.eventTimestamp) === undefined
    ) {
      return false;
    }
    const eventTime = Date.parse(entry.eventTimestamp);
    if (
      eventTime >= Date.parse(windowStart) &&
      eventTime < Date.parse(windowEnd) &&
      comparePosition(
        { eventTimestamp: new Date(eventTime).toISOString(), messageId: entry.messageId },
        watermark
      ) <= 0
    ) {
      return false;
    }
  }
  return true;
}

function buildRawPage(
  binding: PrivateDigestSourceRouteBinding,
  cursor: PrivateDigestSourceCursorClaims | null,
  page: TransactionPage,
  tokens: PrivateDigestSourceTokenCodec
): Result<PrivateDigestSourceRawPage, PrivateDigestSourceError> {
  let sourceRevision: string;
  let highWatermark = cursor?.highWatermark ?? null;
  if (cursor === null) {
    const revision = tokens.issueSourceRevision({
      userId: binding.userId,
      sourceAccountId: binding.sourceAccountId,
      generationId: binding.generationId,
      chatId: binding.chatId,
      chatType: binding.chatType,
      contextChangeSequence: page.currentContextSequence,
      windowStart: binding.windowStart,
      windowEnd: binding.windowEnd,
      highWatermark: page.watermark,
    });
    if (!revision.ok) return revision;
    sourceRevision = revision.value;
    if (page.watermark !== null) {
      const watermark = tokens.issueHighWatermark({ ...binding, watermark: page.watermark });
      if (!watermark.ok) return watermark;
      highWatermark = watermark.value;
    }
  } else {
    sourceRevision = cursor.sourceRevision;
  }

  let nextCursor: string | null = null;
  if (page.hasMore) {
    const continuation = {
      watermark: page.watermark,
      position: page.lastPosition,
      highWatermark,
    } as {
      watermark: PrivateDigestSourcePosition;
      position: PrivateDigestSourcePosition;
      highWatermark: string;
    };
    const issuedCursor = tokens.issueCursor({
      ...binding,
      watermark: continuation.watermark,
      position: continuation.position,
      validatedContextSequence: page.currentContextSequence,
      sourceRevision,
      highWatermark: continuation.highWatermark,
    });
    if (!issuedCursor.ok) return issuedCursor;
    nextCursor = issuedCursor.value;
  }

  return ok({
    messages: page.messages,
    sourceRevision,
    highWatermark,
    nextCursor,
  });
}

function ownedWindowQuery(
  db: FirestoreClient,
  binding: PrivateDigestSourceRouteBinding,
  windowStart: string,
  windowEnd: string
): Query {
  return db
    .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
    .where('sourceAccountId', '==', binding.sourceAccountId)
    .where('chatId', '==', binding.chatId)
    .where('eventTimestamp', '>=', windowStart)
    .where('eventTimestamp', '<', windowEnd);
}

function positionFromSnapshot(
  snapshot: Pick<QueryDocumentSnapshot, 'id' | 'data'>
): PrivateDigestSourcePosition {
  const data: unknown = snapshot.data();
  if (!isRecord(data)) {
    throw new Error('Invalid private WhatsApp message');
  }
  const timestamp = data['eventTimestamp'];
  if (typeof timestamp !== 'string') {
    throw new Error('Invalid private WhatsApp message timestamp');
  }
  return { eventTimestamp: timestamp, messageId: snapshot.id };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOwnedMessageSnapshot(
  snapshot: Pick<QueryDocumentSnapshot, 'data'>,
  binding: PrivateDigestSourceRouteBinding
): boolean {
  const data: unknown = snapshot.data();
  return (
    isRecord(data) &&
    data['userId'] === binding.userId &&
    data['sourceAccountId'] === binding.sourceAccountId &&
    data['chatId'] === binding.chatId
  );
}

function toPrivateWhatsAppMessage(snapshot: QueryDocumentSnapshot): PrivateWhatsAppMessage {
  const data = snapshot.data() as Omit<PrivateWhatsAppMessage, 'id'> & { id?: string };
  return { ...data, id: data.id ?? snapshot.id };
}

function comparePosition(
  left: PrivateDigestSourcePosition,
  right: PrivateDigestSourcePosition
): number {
  const timestamp = Date.parse(left.eventTimestamp) - Date.parse(right.eventTimestamp);
  return timestamp === 0 ? left.messageId.localeCompare(right.messageId) : timestamp;
}

function normalizeIsoTimestamp(value: string): string | undefined {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

function contextSequence(value: unknown): number | undefined {
  if (value === undefined || value === null) return 0;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isValidCursorClaims(
  claims: PrivateDigestSourceCursorClaims,
  binding: PrivateDigestSourceRouteBinding
): boolean {
  return (
    claims.userId === binding.userId &&
    claims.sourceAccountId === binding.sourceAccountId &&
    claims.generationId === binding.generationId &&
    claims.chatId === binding.chatId &&
    claims.chatType === binding.chatType &&
    claims.windowStart === binding.windowStart &&
    claims.windowEnd === binding.windowEnd &&
    Number.isInteger(claims.validatedContextSequence) &&
    claims.validatedContextSequence >= 0 &&
    normalizeIsoTimestamp(claims.watermark.eventTimestamp) !== undefined &&
    normalizeIsoTimestamp(claims.position.eventTimestamp) !== undefined &&
    claims.watermark.messageId.length > 0 &&
    claims.position.messageId.length > 0 &&
    comparePosition(claims.position, claims.watermark) <= 0 &&
    claims.sourceRevision.length > 0 &&
    claims.highWatermark.length > 0
  );
}

function privateSourceNotFound(): Result<never, PrivateDigestSourceError> {
  return err({ code: 'NOT_FOUND', message: 'Private WhatsApp source not found' });
}

function privateChatNotFound(): Result<never, PrivateDigestSourceError> {
  return err({ code: 'NOT_FOUND', message: 'Private WhatsApp chat not found' });
}

function sourceChanged(): Result<never, PrivateDigestSourceError> {
  return err({ code: 'SOURCE_CHANGED', message: 'Private WhatsApp source changed' });
}
