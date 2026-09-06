import { createHash, randomUUID } from 'node:crypto';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import {
  FieldPath,
  getFirestore,
  type Query,
  type QueryDocumentSnapshot,
} from '@intexuraos/infra-firestore';
import type { WhatsAppError } from '../../domain/whatsapp/index.js';
import {
  createPrivateWhatsAppChatId,
  createPrivateWhatsAppMessageId,
  createPrivateWhatsAppSenderDayId,
  createPrivateWhatsAppSenderId,
} from '../../domain/whatsapp/utils/privateWhatsAppIds.js';
import type {
  DisablePrivateWhatsAppAccountInput,
  PrivateWhatsAppAccount,
  PrivateWhatsAppAggregateRebuildInput,
  PrivateWhatsAppAggregateRebuildResult,
  PrivateWhatsAppChat,
  PrivateWhatsAppChatQueryInput,
  PrivateWhatsAppChatQueryResult,
  PrivateWhatsAppConversationContextMessageResult,
  PrivateWhatsAppIngestOutcome,
  PrivateWhatsAppMessage,
  PrivateWhatsAppMessageQueryInput,
  PrivateWhatsAppMessageQueryResult,
  PrivateWhatsAppSender,
  PrivateWhatsAppSenderQueryInput,
  PrivateWhatsAppSenderQueryResult,
  PrivateWhatsAppSenderDay,
  PrivateWhatsAppSenderDayQueryInput,
  PrivateWhatsAppSenderDayQueryResult,
  StorePrivateWhatsAppMessageInput,
  UpdatePrivateWhatsAppChatTranscriptionInput,
  UpdatePrivateWhatsAppMessageStoredMediaInput,
  UpdatePrivateWhatsAppMessageStoredMediaResult,
  UpdatePrivateWhatsAppMessageTranscriptionInput,
  UpdatePrivateWhatsAppMessageTranscriptionResult,
  UpsertPrivateWhatsAppAccountInput,
} from '../../domain/whatsapp/index.js';
import type {
  PrivateWhatsAppContextChange,
  PrivateWhatsAppContextJournalQueryInput,
  PrivateWhatsAppContextJournalQueryResult,
  PrivateWhatsAppContextMessagesByIdsInput,
  PrivateWhatsAppContextProjection,
  PrivateWhatsAppOwnedChatInput,
} from '../../domain/whatsapp/models/PrivateWhatsAppContextJournal.js';
import type {
  PrivateConversationContextMessageQueryInput,
  PrivateWhatsAppReactionQueryInput,
  PrivateWhatsAppReactionQueryResult,
  PrivateWhatsAppReactionSummary,
} from '../../domain/whatsapp/models/PrivateWhatsApp.js';
import type { PrivateWhatsAppRepository } from '../../domain/whatsapp/index.js';

export const PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION = 'whatsapp_private_accounts';
export const PRIVATE_WHATSAPP_CHATS_COLLECTION = 'whatsapp_private_chats';
export const PRIVATE_WHATSAPP_MESSAGES_COLLECTION = 'whatsapp_private_messages';
export const PRIVATE_WHATSAPP_SENDERS_COLLECTION = 'whatsapp_private_senders';
export const PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION = 'whatsapp_private_sender_days';
export const PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION = 'whatsapp_private_context_changes';
const PRIVATE_WHATSAPP_ERASURE_REQUESTS_FENCE_COLLECTION =
  'whatsapp_private_erasure_requests';
const PRIVATE_WHATSAPP_ACCOUNT_SCHEMA_VERSION = 1;
const PRIVATE_WHATSAPP_SCHEMA_VERSION = 2;
const PRIVATE_WHATSAPP_EVENT_TIME_ZONE = 'Europe/Warsaw';
const PENDING_OPERATION_RESOLUTION_BATCH_SIZE = 100;
const LEGACY_REACTION_TARGET_MATRIX_EVENT_ID_FIELD =
  'rawMatrixEvent.content.`m.relates_to`.event_id';
const PRIVATE_WHATSAPP_MESSAGE_TYPES = new Set<PrivateWhatsAppMessage['messageType']>([
  'text',
  'image',
  'audio',
  'video',
  'file',
  'sticker',
  'reaction',
  'redaction',
  'unknown',
]);
const REVIEWED_RELATION_TARGET_UNAVAILABLE_REASONS = new Set<string>([
  'matrix_notice',
  'redacted_reaction_tombstone',
]);
type FirestoreClient = ReturnType<typeof getFirestore>;
type FirestoreTransaction = Parameters<Parameters<FirestoreClient['runTransaction']>[0]>[0];

interface PrivateChatResolution {
  chatId: string;
}

interface PrivateWhatsAppMessageDisplayNames {
  senderDisplayName?: string;
  chatDisplayName?: string;
}

interface PrivateWhatsAppPendingOperationResolution {
  status: 'pending' | 'completed';
  cursorEventTimestamp?: string;
  cursorMessageId?: string;
  completedAt?: string;
}

type StoredPrivateWhatsAppMessage = PrivateWhatsAppMessage & {
  pendingOperationResolution?: PrivateWhatsAppPendingOperationResolution;
};

type StoredPrivateWhatsAppMessageData = Omit<StoredPrivateWhatsAppMessage, 'id'> & {
  id?: string;
};

interface PrivateWhatsAppMessageSnapshot {
  readonly id: string;
  readonly exists: boolean;
  data(): unknown;
}

export {
  createPrivateWhatsAppChatId,
  createPrivateWhatsAppMessageId,
  createPrivateWhatsAppSenderDayId,
  createPrivateWhatsAppSenderId,
} from '../../domain/whatsapp/utils/privateWhatsAppIds.js';

function createPrivateWhatsAppSourceAccountId(userId: string, generationId: string): string {
  const hash = createHash('sha256')
    .update(`private-whatsapp\0${userId}\0${generationId}`)
    .digest('hex');
  return `private-wa-${hash.slice(0, 24)}`;
}

function createLegacyPrivateWhatsAppSourceAccountId(userId: string): string {
  const hash = createHash('sha256').update(`private-whatsapp\0${userId}`).digest('hex');
  return `private-wa-${hash.slice(0, 24)}`;
}

export function createPrivateWhatsAppRepository(): PrivateWhatsAppRepository {
  return {
    getAccountByUserId,
    getActiveAccountBySourceAccountId,
    upsertAccount,
    disableAccount,
    storeIncomingMessage,
    getMessageById,
    getChatById,
    updateChatTranscriptionSetting,
    updateMessageStoredMedia,
    updateMessageTranscription,
    getConversationContextJournalHead,
    findConversationContextJournalEntries,
    findConversationContextMessagesByIds,
    findMessages,
    findReactionsForMessageIds,
    findConversationContextMessages,
    findChats,
    findSenders,
    findSenderDays,
    rebuildAggregates,
  };
}

async function getAccountByUserId(
  userId: string
): Promise<Result<PrivateWhatsAppAccount | null, WhatsAppError>> {
  try {
    const doc = await getFirestore().collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(userId).get();
    if (!doc.exists) {
      return ok(null);
    }
    return ok(toPrivateWhatsAppAccount(doc.id, doc.data()));
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to load private WhatsApp account: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function getActiveAccountBySourceAccountId(
  sourceAccountId: string
): Promise<Result<PrivateWhatsAppAccount | null, WhatsAppError>> {
  try {
    const snapshot = await getFirestore()
      .collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION)
      .where('sourceAccountId', '==', sourceAccountId)
      .where('status', '==', 'active')
      .limit(2)
      .get();
    if (snapshot.docs.length === 0) {
      return ok(null);
    }
    if (snapshot.docs.length > 1) {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: 'Multiple active private WhatsApp accounts share the same source account id',
      });
    }
    const doc = snapshot.docs[0] as (typeof snapshot.docs)[number];
    return ok(toPrivateWhatsAppAccount(doc.id, doc.data()));
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to resolve private WhatsApp account: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function upsertAccount(
  input: UpsertPrivateWhatsAppAccountInput
): Promise<Result<PrivateWhatsAppAccount, WhatsAppError>> {
  try {
    const db = getFirestore();
    const accountRef = db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(input.userId);
    const outcome = await db.runTransaction(async (transaction) => {
      const existingDoc = await transaction.get(accountRef);
      const existingAccount = existingDoc.exists
        ? toPrivateWhatsAppAccount(existingDoc.id, existingDoc.data())
        : undefined;
      if (existingAccount?.erasureStatus === 'erasing') {
        return { status: 'fenced' as const };
      }
      if (existingAccount === undefined) {
        const erasureSnapshot = await transaction.get(
          db
            .collection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_FENCE_COLLECTION)
            .where('userId', '==', input.userId)
        );
        if (
          erasureSnapshot.docs.some((document) => {
            const status = (document.data() as Record<string, unknown>)['status'];
            return status === 'queued' || status === 'running';
          })
        ) {
          return { status: 'fenced' as const };
        }
      }
      const nextAccount = buildPrivateWhatsAppAccount(input, existingAccount);
      transaction.set(accountRef, nextAccount);
      return { status: 'ok' as const, account: nextAccount };
    });
    if (outcome.status === 'fenced') return mutationFencedError();
    return ok(outcome.account);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to save private WhatsApp account: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function disableAccount(
  input: DisablePrivateWhatsAppAccountInput
): Promise<Result<PrivateWhatsAppAccount, WhatsAppError>> {
  try {
    const db = getFirestore();
    const accountRef = db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(input.userId);
    const outcome = await db.runTransaction(
      async (
        transaction
      ): Promise<{ status: 'not_found' } | { status: 'ok'; account: PrivateWhatsAppAccount }> => {
        const existingDoc = await transaction.get(accountRef);
        if (!existingDoc.exists) {
          return { status: 'not_found' };
        }
        const existingAccount = toPrivateWhatsAppAccount(existingDoc.id, existingDoc.data());
        const account: PrivateWhatsAppAccount = {
          ...existingAccount,
          status: 'disabled',
          updatedAt: input.now,
          schemaVersion: PRIVATE_WHATSAPP_ACCOUNT_SCHEMA_VERSION,
        };
        transaction.set(accountRef, account);
        return { status: 'ok', account };
      }
    );
    if (outcome.status === 'not_found') {
      return err({ code: 'NOT_FOUND', message: 'Private WhatsApp account not found' });
    }
    return ok(outcome.account);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to disable private WhatsApp account: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

function toPrivateWhatsAppAccount(
  id: string,
  data: Record<string, unknown> | undefined
): PrivateWhatsAppAccount {
  const account = data as Partial<PrivateWhatsAppAccount> | undefined;
  const fallbackSourceAccountId = createLegacyPrivateWhatsAppSourceAccountId(id);
  const sourceAccountId =
    typeof account?.sourceAccountId === 'string'
      ? account.sourceAccountId
      : fallbackSourceAccountId;
  const projected: PrivateWhatsAppAccount = {
    id,
    userId: typeof account?.userId === 'string' ? account.userId : id,
    sourceAccountId,
    generationId:
      typeof account?.generationId === 'string' && account.generationId.length > 0
        ? account.generationId
        : sourceAccountId,
    phoneNumberNormalized:
      typeof account?.phoneNumberNormalized === 'string' ? account.phoneNumberNormalized : '',
    displayName: typeof account?.displayName === 'string' ? account.displayName : '',
    status: account?.status === 'disabled' ? 'disabled' : 'active',
    createdAt: typeof account?.createdAt === 'string' ? account.createdAt : '',
    updatedAt: typeof account?.updatedAt === 'string' ? account.updatedAt : '',
    schemaVersion: PRIVATE_WHATSAPP_ACCOUNT_SCHEMA_VERSION,
  };
  if (typeof account?.lastIngestAt === 'string') {
    projected.lastIngestAt = account.lastIngestAt;
  }
  if (typeof account?.lastEventAt === 'string') {
    projected.lastEventAt = account.lastEventAt;
  }
  if (account?.erasureStatus === 'erasing') {
    projected.erasureStatus = 'erasing';
  }
  if (typeof account?.erasureRequestId === 'string') {
    projected.erasureRequestId = account.erasureRequestId;
  }
  if (typeof account?.messageCount === 'number') {
    projected.messageCount = account.messageCount;
  }
  if (typeof account?.senderCount === 'number') {
    projected.senderCount = account.senderCount;
  }
  if (account?.erasureStatus === 'erasing') {
    projected.erasureStatus = 'erasing';
  }
  if (typeof account?.erasureRequestId === 'string') {
    projected.erasureRequestId = account.erasureRequestId;
  }
  return projected;
}

function buildPrivateWhatsAppAccount(
  input: UpsertPrivateWhatsAppAccountInput,
  existingAccount: PrivateWhatsAppAccount | undefined
): PrivateWhatsAppAccount {
  const generationId =
    existingAccount?.generationId ?? `private-wa-generation-${randomUUID()}`;
  const account: PrivateWhatsAppAccount = {
    id: input.userId,
    userId: input.userId,
    sourceAccountId:
      existingAccount?.sourceAccountId ??
      createPrivateWhatsAppSourceAccountId(input.userId, generationId),
    generationId,
    phoneNumberNormalized: input.phoneNumberNormalized,
    displayName: input.displayName ?? existingAccount?.displayName ?? `+${input.phoneNumberNormalized}`,
    status: 'active',
    createdAt: existingAccount?.createdAt ?? input.now,
    updatedAt: input.now,
    schemaVersion: PRIVATE_WHATSAPP_ACCOUNT_SCHEMA_VERSION,
  };
  if (existingAccount?.lastIngestAt !== undefined) {
    account.lastIngestAt = existingAccount.lastIngestAt;
  }
  if (existingAccount?.lastEventAt !== undefined) {
    account.lastEventAt = existingAccount.lastEventAt;
  }
  if (existingAccount?.messageCount !== undefined) {
    account.messageCount = existingAccount.messageCount;
  }
  if (existingAccount?.senderCount !== undefined) {
    account.senderCount = existingAccount.senderCount;
  }
  return account;
}

function buildAccountIngestFields(
  input: StorePrivateWhatsAppMessageInput,
  existingAccount: PrivateWhatsAppAccount,
  senderAlreadyExists: boolean
): PrivateWhatsAppAccount {
  const now = new Date().toISOString();
  return {
    ...existingAccount,
    lastIngestAt: now,
    lastEventAt: newestTimestamp(existingAccount.lastEventAt, input.message.eventTimestamp),
    messageCount: (existingAccount.messageCount ?? 0) + 1,
    senderCount: (existingAccount.senderCount ?? 0) + (senderAlreadyExists ? 0 : 1),
    updatedAt: now,
    schemaVersion: PRIVATE_WHATSAPP_ACCOUNT_SCHEMA_VERSION,
  };
}

async function isPrivateWhatsAppMutationFenced(
  db: FirestoreClient,
  transaction: FirestoreTransaction,
  input: { userId?: string; sourceAccountId?: string }
): Promise<boolean> {
  if (input.sourceAccountId !== undefined) {
    const erasureSnapshot = await transaction.get(
      db
        .collection(PRIVATE_WHATSAPP_ERASURE_REQUESTS_FENCE_COLLECTION)
        .where('sourceAccountId', '==', input.sourceAccountId)
        .limit(1)
    );
    if (erasureSnapshot.docs.length > 0) return true;
  }
  if (input.userId === undefined) return false;
  const accountSnapshot = await transaction.get(
    db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(input.userId)
  );
  if (!accountSnapshot.exists) return true;
  const account = accountSnapshot.data();
  return (
    account?.['userId'] !== input.userId ||
    (input.sourceAccountId !== undefined &&
      account['sourceAccountId'] !== input.sourceAccountId) ||
    account['erasureStatus'] === 'erasing'
  );
}

function mutationFencedError<T>(): Result<T, WhatsAppError> {
  return err({
    code: 'VALIDATION_ERROR',
    message: 'Private WhatsApp account generation is being erased',
    httpStatus: 409,
  });
}

async function storeIncomingMessage(
  input: StorePrivateWhatsAppMessageInput
): Promise<Result<PrivateWhatsAppIngestOutcome, WhatsAppError>> {
  try {
    const db = getFirestore();
    const messageId = createPrivateWhatsAppMessageId(
      input.sourceAccountId,
      input.message.matrixEventId
    );
    const senderKey = getSenderKey(input);
    const eventDayKey = getEventDayKey(input);
    const senderId = createPrivateWhatsAppSenderId(input.sourceAccountId, senderKey);
    const senderDayId = createPrivateWhatsAppSenderDayId(
      input.sourceAccountId,
      senderKey,
      eventDayKey
    );
    const messageRef = db.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(messageId);
    const senderRef = db.collection(PRIVATE_WHATSAPP_SENDERS_COLLECTION).doc(senderId);
    const senderDayRef = db.collection(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION).doc(senderDayId);
    const accountRef = db.collection(PRIVATE_WHATSAPP_ACCOUNTS_COLLECTION).doc(input.userId);

    const outcome = await db.runTransaction(async (transaction) => {
      if (
        await isPrivateWhatsAppMutationFenced(db, transaction, {
          userId: input.userId,
          sourceAccountId: input.sourceAccountId,
        })
      ) {
        return { outcome: 'fenced' as const };
      }
      const existingMessage = await transaction.get(messageRef);
      if (existingMessage.exists) {
        const existingData = existingMessage.data() as
          | Partial<StoredPrivateWhatsAppMessage>
          | undefined;
        const existingChatId =
          typeof existingData?.chatId === 'string'
            ? existingData.chatId
            : createPrivateWhatsAppChatId(input.sourceAccountId, input.chat.matrixRoomId);
        const duplicateOperationRepair = buildBackfillDuplicateOperationRepair(
          existingData,
          input,
          existingChatId
        );
        if (duplicateOperationRepair !== undefined) {
          transaction.set(messageRef, duplicateOperationRepair, { merge: true });
        }
        return {
          outcome: 'duplicate' as const,
          chatId: existingChatId,
          messageId,
          matrixEventId: input.message.matrixEventId,
          shouldResolvePendingOperations:
            input.message.relation === undefined &&
            input.message.type !== 'reaction' &&
            existingData?.userId === input.userId &&
            existingData.sourceAccountId === input.sourceAccountId &&
            existingData.chatId === existingChatId &&
            existingData.matrixEventId === input.message.matrixEventId &&
            existingData.relation === undefined &&
            existingData.messageType !== 'reaction' &&
            existingData.messageType !== 'redaction' &&
            existingData.pendingOperationResolution?.status !== 'completed',
          shouldResolvePendingOperationalRedactions:
            (existingData?.relation !== undefined || existingData?.messageType === 'reaction') &&
            existingData.userId === input.userId &&
            existingData.sourceAccountId === input.sourceAccountId &&
            existingData.chatId === existingChatId &&
            existingData.matrixEventId === input.message.matrixEventId &&
            existingData.pendingOperationResolution?.status === 'pending',
        };
      }

      const chatResolution = await resolveChatForStore(db, transaction, input, senderKey);
      const chatId = chatResolution.chatId;
      const chatRef = db.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(chatId);
      const existingChat = await transaction.get(chatRef);
      const existingSender = await transaction.get(senderRef);
      const existingSenderDay = await transaction.get(senderDayRef);
      const existingAccount = await transaction.get(accountRef);
      const contextTargetMatrixEventId =
        input.message.relation?.targetMatrixEventId ?? input.message.reaction?.targetMatrixEventId;
      const relationTargetMessageId =
        contextTargetMatrixEventId === undefined
          ? undefined
          : createPrivateWhatsAppMessageId(
              input.sourceAccountId,
              contextTargetMatrixEventId
            );
      const relationTargetRef =
        relationTargetMessageId === undefined
          ? undefined
          : db.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(relationTargetMessageId);
      const relationTargetDoc =
        relationTargetRef === undefined ? undefined : await transaction.get(relationTargetRef);
      const relationTargetData = readStoredPrivateWhatsAppMessage(relationTargetDoc);
      const redactedReplacementLogicalTargetMessageId =
        input.message.relation?.kind === 'redaction' &&
        relationTargetData?.relation?.kind === 'replacement'
          ? relationTargetData.relation.targetMessageId
          : undefined;
      const redactedReplacementLogicalTargetRef =
        redactedReplacementLogicalTargetMessageId === undefined
          ? undefined
          : db
              .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
              .doc(redactedReplacementLogicalTargetMessageId);
      const redactedReplacementLogicalTargetDoc =
        redactedReplacementLogicalTargetRef === undefined
          ? undefined
          : await transaction.get(redactedReplacementLogicalTargetRef);
      const replacementHistorySnapshot =
        redactedReplacementLogicalTargetMessageId === undefined
          ? undefined
          : await transaction.get(
              db
                .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
                .where('sourceAccountId', '==', input.sourceAccountId)
                .where('chatId', '==', chatId)
                .where(
                  'relation.targetMessageId',
                  '==',
                  redactedReplacementLogicalTargetMessageId
                )
                .where('relation.kind', '==', 'replacement')
                .orderBy('eventTimestamp', 'desc')
                .orderBy(FieldPath.documentId(), 'desc')
            );
      const redactedReactionLogicalTargetMessageId =
        input.message.relation?.kind === 'redaction' &&
        relationTargetData?.messageType === 'reaction'
          ? relationTargetData.reaction?.targetMessageId
          : undefined;
      const redactedReactionLogicalTargetRef =
        redactedReactionLogicalTargetMessageId === undefined
          ? undefined
          : db
              .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
              .doc(redactedReactionLogicalTargetMessageId);
      const redactedReactionLogicalTargetDoc =
        redactedReactionLogicalTargetRef === undefined
          ? undefined
          : await transaction.get(redactedReactionLogicalTargetRef);
      const shouldResolvePendingOperations =
        input.message.relation === undefined && input.message.type !== 'reaction';
      const pendingRelationExists = shouldResolvePendingOperations
        ? (
            await transaction.get(
              db
                .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
                .where('sourceAccountId', '==', input.sourceAccountId)
                .where('chatId', '==', chatId)
                .where('relation.targetMatrixEventId', '==', input.message.matrixEventId)
                .where('relation.applicationStatus', '==', 'pending')
                .limit(1)
            )
          ).docs.length > 0
        : false;
      const pendingReactionExists = shouldResolvePendingOperations
        ? (
            await transaction.get(
              db
                .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
                .where('sourceAccountId', '==', input.sourceAccountId)
                .where('chatId', '==', chatId)
                .where('messageType', '==', 'reaction')
                .where('reaction.targetMatrixEventId', '==', input.message.matrixEventId)
                .limit(1)
            )
          ).docs.length > 0
        : false;
      const shouldResolvePendingRedactionForOperationalMessage =
        input.message.relation !== undefined || input.message.type === 'reaction';
      const pendingOperationalRedactionsSnapshot =
        shouldResolvePendingRedactionForOperationalMessage
          ? await transaction.get(
              db
                .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
                .where('sourceAccountId', '==', input.sourceAccountId)
                .where('chatId', '==', chatId)
                .where('relation.kind', '==', 'redaction')
                .where('relation.targetMatrixEventId', '==', input.message.matrixEventId)
                .where('relation.applicationStatus', '==', 'pending')
                .orderBy('eventTimestamp', 'asc')
                .orderBy(FieldPath.documentId(), 'asc')
                .limit(PENDING_OPERATION_RESOLUTION_BATCH_SIZE + 1)
            )
          : undefined;
      const existingChatData = existingChat.data() as PrivateWhatsAppChat | undefined;
      const chat = buildChat(input, chatId, existingChatData);
      const sender = buildSender(
        input,
        senderId,
        chatId,
        existingSender.data() as PrivateWhatsAppSender | undefined,
        getDirectChatDisplayName(chat)
      );
      const senderDay = buildSenderDay(
        input,
        senderDayId,
        chatId,
        existingSenderDay.data() as PrivateWhatsAppSenderDay | undefined,
        sender.senderDisplayName
      );
      const messageDisplayNames: PrivateWhatsAppMessageDisplayNames = {};
      if (sender.senderDisplayName !== undefined) {
        messageDisplayNames.senderDisplayName = sender.senderDisplayName;
      }
      if (chat.displayName !== undefined) {
        messageDisplayNames.chatDisplayName = chat.displayName;
      }
      let message: StoredPrivateWhatsAppMessage = buildMessage(
        input,
        chatId,
        messageId,
        messageDisplayNames
      );
      const contextChanges: PrivateWhatsAppContextChange[] = [];
      let logicalTargetToWrite: PrivateWhatsAppMessage | undefined;
      let logicalTargetRefToWrite = relationTargetRef;
      let operationalTargetToWrite: PrivateWhatsAppMessage | undefined;
      const pendingOperationalWrites: PrivateWhatsAppMessage[] = [];
      let shouldResolvePendingOperationalRedactions = false;
      const reviewedPolicySkipRepair = buildBackfillDuplicateOperationRepair(
        message,
        input,
        chatId
      );

      const allPendingRedactions = pendingOperationalRedactionsSnapshot?.docs ?? [];
      if (reviewedPolicySkipRepair !== undefined) {
        message = { ...message, ...reviewedPolicySkipRepair };
      } else if (allPendingRedactions.length > 0) {
        const pendingRedactions = allPendingRedactions.slice(
          0,
          PENDING_OPERATION_RESOLUTION_BATCH_SIZE
        );
        const firstPendingRedaction = pendingRedactions[0] as QueryDocumentSnapshot;
        const firstRedaction = toStoredPrivateWhatsAppMessage(firstPendingRedaction);
          const redactedAt = firstRedaction.eventTimestamp;
          message =
            message.messageType === 'reaction'
              ? createRedactedReactionMessage({ target: message, redactedAt })
              : createRedactedOperationalMessage({ target: message, redactedAt });
          if (message.relation !== undefined) {
            message.relation = {
              ...message.relation,
              applicationStatus: 'superseded',
              appliedAt: new Date().toISOString(),
            };
          }
          for (const [index, pendingDocument] of pendingRedactions.entries()) {
            const pendingRedaction = toStoredPrivateWhatsAppMessage(pendingDocument);
            pendingRedaction.relation = {
              ...(pendingRedaction.relation as NonNullable<PrivateWhatsAppMessage['relation']>),
              targetMessageId: message.id,
              applicationStatus: index === 0 ? 'applied' : 'superseded',
              appliedAt: new Date().toISOString(),
            };
            pendingOperationalWrites.push(pendingRedaction);
          }
          const lastPendingRedaction = pendingRedactions[
            pendingRedactions.length - 1
          ] as QueryDocumentSnapshot;
          const cursorEventTimestamp = asOptionalString(
            lastPendingRedaction.data()['eventTimestamp']
          );
          shouldResolvePendingOperationalRedactions =
            allPendingRedactions.length > PENDING_OPERATION_RESOLUTION_BATCH_SIZE;
          message.pendingOperationResolution =
            shouldResolvePendingOperationalRedactions &&
            cursorEventTimestamp !== undefined
              ? {
                  status: 'pending',
                  cursorEventTimestamp,
                  cursorMessageId: lastPendingRedaction.id,
                }
              : { status: 'completed', completedAt: new Date().toISOString() };
      } else if (message.relation?.kind === 'replacement') {
        const target = readStoredPrivateWhatsAppMessage(relationTargetDoc);
        const replacementText = firstNonEmptyString(message.text);
        const isNewerThanAppliedReplacement = isLaterContextOperation({
          candidateTimestamp: message.eventTimestamp,
          candidateId: message.id,
          currentTimestamp: target?.latestReplacementEventTimestamp,
          currentId: target?.latestReplacementMessageId,
        });
        const canApply =
          target?.sourceAccountId === input.sourceAccountId &&
          target.userId === input.userId &&
          target.chatId === chatId &&
          target.contextState !== 'redacted' &&
          target.contextState !== 'deleted' &&
          replacementText !== undefined &&
          isNewerThanAppliedReplacement;

        if (canApply) {
          const before = toContextProjection(target);
          const updatedTarget: PrivateWhatsAppMessage = {
            ...target,
            text: replacementText,
            ...originalContextTextFields(target),
            editedAt: message.eventTimestamp,
            latestReplacementMessageId: message.id,
            latestReplacementEventTimestamp: message.eventTimestamp,
          };
          const after = toContextProjection(updatedTarget);
          const projectionChanged = !areJsonValuesEqual(before, after);
          const changedAt = new Date().toISOString();
          message.relation = {
            ...message.relation,
            targetMessageId: target.id,
            applicationStatus: 'applied',
            appliedAt: changedAt,
          };
          if (projectionChanged) {
            const contextChangeSequence = (existingChatData?.contextChangeSequence ?? 0) + 1;
            const contextRevision = (target.contextRevision ?? 1) + 1;
            chat.contextChangeSequence = contextChangeSequence;
            chat.contextChangedAt = changedAt;
            updatedTarget.contextRevision = contextRevision;
            updatedTarget.contextChangeSequence = contextChangeSequence;
            updatedTarget.contextState = 'visible';
            logicalTargetToWrite = updatedTarget;
            contextChanges.push({
              userId: input.userId,
              sourceAccountId: input.sourceAccountId,
              chatId,
              sequence: contextChangeSequence,
              messageId: target.id,
              messageRevision: contextRevision,
              changeType: 'edited',
              changedAt,
              eventTimestamp: target.eventTimestamp,
              before,
              after,
              schemaVersion: 1,
            });
          }
        } else if (target !== undefined) {
          message.relation = {
            ...message.relation,
            targetMessageId: target.id,
            applicationStatus: 'superseded',
            appliedAt: new Date().toISOString(),
          };
        } else {
          message.relation = {
            ...message.relation,
            targetMessageId: relationTargetMessageId as string,
            applicationStatus: 'pending',
          };
        }
      } else if (
        message.relation?.kind === 'redaction' &&
        relationTargetData?.relation?.kind === 'replacement'
      ) {
        const replacementTarget = relationTargetData;
        const logicalTarget = readStoredPrivateWhatsAppMessage(
          redactedReplacementLogicalTargetDoc
        );
        const isOwnedReplacement =
          replacementTarget.sourceAccountId === input.sourceAccountId &&
          replacementTarget.userId === input.userId &&
          replacementTarget.chatId === chatId;
        const isOwnedLogicalTarget =
          logicalTarget?.sourceAccountId === input.sourceAccountId &&
          logicalTarget.userId === input.userId &&
          logicalTarget.chatId === chatId;

        if (isOwnedReplacement && isOwnedLogicalTarget) {
          const changedAt = new Date().toISOString();
          message.relation = {
            ...message.relation,
            targetMessageId: replacementTarget.id,
            applicationStatus: 'applied',
            appliedAt: changedAt,
          };
          operationalTargetToWrite = createRedactedOperationalMessage({
            target: replacementTarget,
            redactedAt: message.eventTimestamp,
          });

          if (logicalTarget.latestReplacementMessageId === replacementTarget.id) {
            const previousReplacement = (replacementHistorySnapshot as {
              docs: QueryDocumentSnapshot[];
            }).docs
              .map(toStoredPrivateWhatsAppMessage)
              .find(
                (candidate) =>
                  candidate.id !== replacementTarget.id &&
                  candidate.contextState !== 'redacted' &&
                  candidate.contextState !== 'deleted' &&
                  firstNonEmptyString(candidate.text) !== undefined
              );
            const previousText = firstNonEmptyString(previousReplacement?.text);
            const originalText = firstNonEmptyString(logicalTarget.contextOriginalText);
            const {
              text: _text,
              editedAt: _editedAt,
              latestReplacementMessageId: _latestReplacementMessageId,
              latestReplacementEventTimestamp: _latestReplacementEventTimestamp,
              ...logicalTargetWithoutReplacement
            } = logicalTarget;
            const restoredReplacementFields:
              | Pick<
                  PrivateWhatsAppMessage,
                  | 'text'
                  | 'editedAt'
                  | 'latestReplacementMessageId'
                  | 'latestReplacementEventTimestamp'
                >
              | Pick<PrivateWhatsAppMessage, 'text'>
              | Record<string, never> =
              previousReplacement !== undefined && previousText !== undefined
                ? {
                    text: previousText,
                    editedAt: previousReplacement.eventTimestamp,
                    latestReplacementMessageId: previousReplacement.id,
                    latestReplacementEventTimestamp: previousReplacement.eventTimestamp,
                  }
                : originalText !== undefined
                  ? { text: originalText }
                  : {};
            const updatedLogicalTarget: PrivateWhatsAppMessage = {
              ...logicalTargetWithoutReplacement,
              ...restoredReplacementFields,
              contextState: 'visible',
            };
            const before = toContextProjection(logicalTarget);
            const after = toContextProjection(updatedLogicalTarget);
            if (!areJsonValuesEqual(before, after)) {
              const contextChangeSequence = (existingChatData?.contextChangeSequence ?? 0) + 1;
              const contextRevision = (logicalTarget.contextRevision ?? 1) + 1;
              chat.contextChangeSequence = contextChangeSequence;
              chat.contextChangedAt = changedAt;
              updatedLogicalTarget.contextRevision = contextRevision;
              updatedLogicalTarget.contextChangeSequence = contextChangeSequence;
              contextChanges.push({
                userId: input.userId,
                sourceAccountId: input.sourceAccountId,
                chatId,
                sequence: contextChangeSequence,
                messageId: logicalTarget.id,
                messageRevision: contextRevision,
                changeType: 'edited',
                changedAt,
                eventTimestamp: logicalTarget.eventTimestamp,
                before,
                after,
                schemaVersion: 1,
              });
            }
            logicalTargetToWrite = updatedLogicalTarget;
            logicalTargetRefToWrite = redactedReplacementLogicalTargetRef;
          }
        } else {
          message.relation = {
            ...message.relation,
            targetMessageId: replacementTarget.id,
            applicationStatus: 'superseded',
            appliedAt: new Date().toISOString(),
          };
        }
      } else if (
        message.relation?.kind === 'redaction' &&
        relationTargetData?.messageType === 'reaction'
      ) {
        const reactionTarget = relationTargetData;
        const logicalTarget = readStoredPrivateWhatsAppMessage(redactedReactionLogicalTargetDoc);
        const isOwnedReaction =
          reactionTarget.sourceAccountId === input.sourceAccountId &&
          reactionTarget.userId === input.userId &&
          reactionTarget.chatId === chatId;
        const isOwnedLogicalTarget =
          logicalTarget?.sourceAccountId === input.sourceAccountId &&
          logicalTarget.userId === input.userId &&
          logicalTarget.chatId === chatId;

        if (isOwnedReaction && isOwnedLogicalTarget) {
          const changedAt = new Date().toISOString();
          const before = toContextProjection(logicalTarget);
          const reactions = sanitizeReactionSummaries(
            (logicalTarget.reactions ?? []).filter(
              (reaction) => reaction.id !== reactionTarget.id
            )
          );
          const updatedLogicalTarget: PrivateWhatsAppMessage = {
            ...logicalTarget,
            reactions,
          };
          const after = toContextProjection(updatedLogicalTarget);
          const projectionChanged = !areJsonValuesEqual(before, after);
          message.relation = {
            ...message.relation,
            targetMessageId: reactionTarget.id,
            applicationStatus: 'applied',
            appliedAt: changedAt,
          };
          operationalTargetToWrite = createRedactedReactionMessage({
            target: reactionTarget,
            redactedAt: message.eventTimestamp,
          });

          if (projectionChanged) {
            const contextChangeSequence = (existingChatData?.contextChangeSequence ?? 0) + 1;
            const contextRevision = (logicalTarget.contextRevision ?? 1) + 1;
            chat.contextChangeSequence = contextChangeSequence;
            chat.contextChangedAt = changedAt;
            updatedLogicalTarget.contextRevision = contextRevision;
            updatedLogicalTarget.contextChangeSequence = contextChangeSequence;
            logicalTargetToWrite = updatedLogicalTarget;
            logicalTargetRefToWrite = redactedReactionLogicalTargetRef;
            contextChanges.push({
              userId: input.userId,
              sourceAccountId: input.sourceAccountId,
              chatId,
              sequence: contextChangeSequence,
              messageId: logicalTarget.id,
              messageRevision: contextRevision,
              changeType: 'reaction_changed',
              changedAt,
              eventTimestamp: logicalTarget.eventTimestamp,
              before,
              after,
              schemaVersion: 1,
            });
          }
        } else {
          message.relation = {
            ...message.relation,
            targetMessageId: reactionTarget.id,
            applicationStatus: 'superseded',
            appliedAt: new Date().toISOString(),
          };
        }
      } else if (message.relation?.kind === 'redaction') {
        const target = readStoredPrivateWhatsAppMessage(relationTargetDoc);
        const isOwnedLogicalTarget =
          target?.sourceAccountId === input.sourceAccountId &&
          target.userId === input.userId &&
          target.chatId === chatId &&
          target.relation === undefined &&
          target.messageType !== 'reaction' &&
          target.messageType !== 'redaction';

        if (
          isOwnedLogicalTarget &&
          target.contextState !== 'redacted' &&
          target.contextState !== 'deleted'
        ) {
          const before = toContextProjection(target);
          const changedAt = new Date().toISOString();
          const contextChangeSequence = (existingChatData?.contextChangeSequence ?? 0) + 1;
          const contextRevision = (target.contextRevision ?? 1) + 1;
          const updatedTarget = createRedactedMessage({
            target,
            redactedAt: message.eventTimestamp,
            contextRevision,
            contextChangeSequence,
          });
          const after = toContextProjection(updatedTarget);
          chat.contextChangeSequence = contextChangeSequence;
          chat.contextChangedAt = changedAt;
          message.relation = {
            ...message.relation,
            targetMessageId: target.id,
            applicationStatus: 'applied',
            appliedAt: changedAt,
          };
          logicalTargetToWrite = updatedTarget;
          contextChanges.push({
            userId: input.userId,
            sourceAccountId: input.sourceAccountId,
            chatId,
            sequence: contextChangeSequence,
            messageId: target.id,
            messageRevision: contextRevision,
            changeType: 'redacted',
            changedAt,
            eventTimestamp: target.eventTimestamp,
            before,
            after,
            schemaVersion: 1,
          });
        } else if (target !== undefined) {
          message.relation = {
            ...message.relation,
            targetMessageId: target.id,
            applicationStatus: 'superseded',
            appliedAt: new Date().toISOString(),
          };
        } else {
          message.relation = {
            ...message.relation,
            targetMessageId: relationTargetMessageId as string,
            applicationStatus: 'pending',
          };
        }
      } else if (message.messageType === 'reaction' && message.reaction !== undefined) {
        const target = readStoredPrivateWhatsAppMessage(relationTargetDoc);
        const reactionSummary = toReactionSummary(message, message.reaction.emoji);
        const canApply =
          target?.sourceAccountId === input.sourceAccountId &&
          target.userId === input.userId &&
          target.chatId === chatId &&
          target.contextState !== 'redacted' &&
          target.contextState !== 'deleted' &&
          target.relation === undefined &&
          target.messageType !== 'reaction' &&
          target.messageType !== 'redaction' &&
          reactionSummary !== undefined;
        if (canApply) {
          const before = toContextProjection(target);
          const reactions = sanitizeReactionSummaries([
            ...(target.reactions ?? []).filter((reaction) => reaction.id !== message.id),
            reactionSummary,
          ]);
          const changedAt = new Date().toISOString();
          const contextChangeSequence = (existingChatData?.contextChangeSequence ?? 0) + 1;
          const contextRevision = (target.contextRevision ?? 1) + 1;
          const updatedTarget: PrivateWhatsAppMessage = {
            ...target,
            reactions,
            contextRevision,
            contextChangeSequence,
            contextState: 'visible',
          };
          const after = toContextProjection(updatedTarget);
          chat.contextChangeSequence = contextChangeSequence;
          chat.contextChangedAt = changedAt;
          message.reaction = {
            ...message.reaction,
            applicationStatus: 'applied',
            appliedAt: changedAt,
          };
          logicalTargetToWrite = updatedTarget;
          contextChanges.push({
            userId: input.userId,
            sourceAccountId: input.sourceAccountId,
            chatId,
            sequence: contextChangeSequence,
            messageId: target.id,
            messageRevision: contextRevision,
            changeType: 'reaction_changed',
            changedAt,
            eventTimestamp: target.eventTimestamp,
            before,
            after,
            schemaVersion: 1,
          });
        } else if (target !== undefined) {
          message.reaction = {
            ...message.reaction,
            applicationStatus: 'superseded',
            appliedAt: new Date().toISOString(),
          };
        }
      } else {
        const changedAt = new Date().toISOString();
        const contextChangeSequence = (existingChatData?.contextChangeSequence ?? 0) + 1;
        chat.contextChangeSequence = contextChangeSequence;
        chat.contextChangedAt = changedAt;
        message.contextRevision = 1;
        message.contextChangeSequence = contextChangeSequence;
        message.contextState = 'visible';
        message.pendingOperationResolution =
          pendingRelationExists || pendingReactionExists
            ? { status: 'pending' }
            : { status: 'completed', completedAt: changedAt };
        contextChanges.push({
          userId: input.userId,
          sourceAccountId: input.sourceAccountId,
          chatId,
          sequence: contextChangeSequence,
          messageId,
          messageRevision: 1,
          changeType: 'created',
          changedAt,
          eventTimestamp: message.eventTimestamp,
          before: { state: 'missing' },
          after: toContextProjection(message),
          schemaVersion: 1,
        });

      }

      transaction.set(chatRef, chat, { merge: true });
      transaction.set(messageRef, message);
      if (logicalTargetToWrite !== undefined && logicalTargetRefToWrite !== undefined) {
        transaction.set(logicalTargetRefToWrite, logicalTargetToWrite);
      }
      if (operationalTargetToWrite !== undefined && relationTargetRef !== undefined) {
        transaction.set(relationTargetRef, operationalTargetToWrite);
      }
      for (const pendingOperation of pendingOperationalWrites) {
        transaction.set(
          db.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(pendingOperation.id),
          pendingOperation
        );
      }
      for (const contextChange of contextChanges) {
        transaction.set(
          db
            .collection(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)
            .doc(createContextChangeId(chatId, contextChange.sequence)),
          contextChange
        );
      }
      transaction.set(senderRef, sender);
      transaction.set(senderDayRef, senderDay);
      transaction.set(
        accountRef,
        buildAccountIngestFields(
          input,
          existingAccount.data() as PrivateWhatsAppAccount,
          existingSender.exists
        ),
        { merge: true }
      );

      return {
        outcome: 'created' as const,
        chatId,
        messageId,
        matrixEventId: input.message.matrixEventId,
        shouldResolvePendingOperations:
          shouldResolvePendingOperations && (pendingRelationExists || pendingReactionExists),
        shouldResolvePendingOperationalRedactions,
        ...(chat.transcriptionEnabled === true ? { chatTranscriptionEnabled: true } : {}),
      };
    });

    if (outcome.outcome === 'fenced') return mutationFencedError();
    const {
      shouldResolvePendingOperations,
      shouldResolvePendingOperationalRedactions,
      ...publicOutcome
    } = outcome;
    if (shouldResolvePendingOperations) {
      const resolution = await resolvePendingTargetOperations({
        db,
        userId: input.userId,
        sourceAccountId: input.sourceAccountId,
        chatId: outcome.chatId,
        targetMessageId: outcome.messageId,
        targetMatrixEventId: outcome.matrixEventId,
      });
      if (!resolution.ok) return resolution;
    }
    if (shouldResolvePendingOperationalRedactions) {
      const resolution = await resolvePendingOperationalRedactions({
        db,
        userId: input.userId,
        sourceAccountId: input.sourceAccountId,
        chatId: outcome.chatId,
        targetMessageId: outcome.messageId,
        targetMatrixEventId: outcome.matrixEventId,
      });
      if (!resolution.ok) return resolution;
    }
    return ok(publicOutcome);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to store private WhatsApp message: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

interface PendingTargetOperationResolutionInput {
  db: FirestoreClient;
  userId: string;
  sourceAccountId: string;
  chatId: string;
  targetMessageId: string;
  targetMatrixEventId: string;
}

interface PendingOperationCursor {
  eventTimestamp: string;
  messageId: string;
}

type PendingTargetOperationBatchOutcome = 'continue' | 'completed' | 'fenced' | 'missing';

async function resolvePendingOperationalRedactions(
  input: PendingTargetOperationResolutionInput
): Promise<Result<void, WhatsAppError>> {
  for (;;) {
    const outcome = await resolvePendingOperationalRedactionsBatch(input);
    if (outcome === 'completed') return ok(undefined);
    if (outcome === 'fenced') return mutationFencedError();
    if (outcome === 'missing') {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: 'Private WhatsApp operational redaction target disappeared during resolution',
      });
    }
  }
}

async function resolvePendingOperationalRedactionsBatch(
  input: PendingTargetOperationResolutionInput
): Promise<PendingTargetOperationBatchOutcome> {
  return await input.db.runTransaction(async (transaction) => {
    if (
      await isPrivateWhatsAppMutationFenced(input.db, transaction, {
        userId: input.userId,
        sourceAccountId: input.sourceAccountId,
      })
    ) {
      return 'fenced';
    }

    const targetRef = input.db
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc(input.targetMessageId);
    const targetDocument = await transaction.get(targetRef);
    if (!targetDocument.exists) return 'missing';
    const target = toStoredPrivateWhatsAppMessage(targetDocument);
    if (
      target.userId !== input.userId ||
      target.sourceAccountId !== input.sourceAccountId ||
      target.chatId !== input.chatId ||
      target.matrixEventId !== input.targetMatrixEventId ||
      (target.relation === undefined && target.messageType !== 'reaction')
    ) {
      return 'missing';
    }
    if (target.pendingOperationResolution?.status === 'completed') return 'completed';

    const cursor = readPendingOperationCursor(target) as PendingOperationCursor;
    const query: Query = input.db
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .where('sourceAccountId', '==', input.sourceAccountId)
      .where('chatId', '==', input.chatId)
      .where('relation.kind', '==', 'redaction')
      .where('relation.targetMatrixEventId', '==', input.targetMatrixEventId)
      .where('relation.applicationStatus', '==', 'pending')
      .orderBy('eventTimestamp', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(PENDING_OPERATION_RESOLUTION_BATCH_SIZE + 1)
      .startAfter(cursor.eventTimestamp, cursor.messageId);

    const snapshot = await transaction.get(query);
    const candidates = snapshot.docs.slice(0, PENDING_OPERATION_RESOLUTION_BATCH_SIZE);
    const appliedAt = new Date().toISOString();
    if (candidates.length === 0) {
      target.pendingOperationResolution = { status: 'completed', completedAt: appliedAt };
      transaction.set(targetRef, target);
      return 'completed';
    }

    for (const candidate of candidates) {
      const redaction = toStoredPrivateWhatsAppMessage(candidate);
      if (
        redaction.userId !== input.userId ||
        redaction.sourceAccountId !== input.sourceAccountId ||
        redaction.chatId !== input.chatId ||
        redaction.relation?.kind !== 'redaction'
      ) {
        continue;
      }
      redaction.relation = {
        ...redaction.relation,
        targetMessageId: target.id,
        applicationStatus: 'superseded',
        appliedAt,
      };
      transaction.set(
        input.db.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(redaction.id),
        redaction
      );
    }

    const lastCandidate = candidates[candidates.length - 1] as QueryDocumentSnapshot;
    const cursorEventTimestamp = readPendingOperationTimestamp(lastCandidate);
    const hasMore = snapshot.docs.length > PENDING_OPERATION_RESOLUTION_BATCH_SIZE;
    target.pendingOperationResolution = hasMore
      ? {
          status: 'pending',
          cursorEventTimestamp,
          cursorMessageId: lastCandidate.id,
        }
      : { status: 'completed', completedAt: appliedAt };
    transaction.set(targetRef, target);
    return hasMore ? 'continue' : 'completed';
  });
}

async function resolvePendingTargetOperations(
  input: PendingTargetOperationResolutionInput
): Promise<Result<void, WhatsAppError>> {
  for (;;) {
    const outcome = await resolvePendingTargetOperationsBatch(input);
    if (outcome === 'completed') return ok(undefined);
    if (outcome === 'fenced') return mutationFencedError();
    if (outcome === 'missing') {
      return err({
        code: 'PERSISTENCE_ERROR',
        message: 'Private WhatsApp pending-operation target disappeared during resolution',
      });
    }
  }
}

async function resolvePendingTargetOperationsBatch(
  input: PendingTargetOperationResolutionInput
): Promise<PendingTargetOperationBatchOutcome> {
  return await input.db.runTransaction(async (transaction) => {
    if (
      await isPrivateWhatsAppMutationFenced(input.db, transaction, {
        userId: input.userId,
        sourceAccountId: input.sourceAccountId,
      })
    ) {
      return 'fenced';
    }

    const targetRef = input.db
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc(input.targetMessageId);
    const chatRef = input.db.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(input.chatId);
    const targetDocument = await transaction.get(targetRef);
    const chatDocument = await transaction.get(chatRef);
    if (!targetDocument.exists || !chatDocument.exists) return 'missing';

    const rawChat = chatDocument.data() as PrivateWhatsAppChat;
    let target = toStoredPrivateWhatsAppMessage(targetDocument);
    if (
      target.userId !== input.userId ||
      target.sourceAccountId !== input.sourceAccountId ||
      target.chatId !== input.chatId ||
      target.matrixEventId !== input.targetMatrixEventId ||
      target.relation !== undefined ||
      target.messageType === 'reaction' ||
      target.messageType === 'redaction'
    ) {
      return 'missing';
    }
    if (target.pendingOperationResolution?.status === 'completed') return 'completed';

    const cursor = readPendingOperationCursor(target);
    let relationQuery: Query = input.db
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .where('sourceAccountId', '==', input.sourceAccountId)
      .where('chatId', '==', input.chatId)
      .where('relation.targetMatrixEventId', '==', input.targetMatrixEventId)
      .orderBy('eventTimestamp', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(PENDING_OPERATION_RESOLUTION_BATCH_SIZE + 1);
    let reactionQuery: Query = input.db
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .where('sourceAccountId', '==', input.sourceAccountId)
      .where('chatId', '==', input.chatId)
      .where('messageType', '==', 'reaction')
      .where('reaction.targetMatrixEventId', '==', input.targetMatrixEventId)
      .orderBy('eventTimestamp', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(PENDING_OPERATION_RESOLUTION_BATCH_SIZE + 1);
    if (cursor !== undefined) {
      relationQuery = relationQuery.startAfter(cursor.eventTimestamp, cursor.messageId);
      reactionQuery = reactionQuery.startAfter(cursor.eventTimestamp, cursor.messageId);
    }

    const relationSnapshot = await transaction.get(relationQuery);
    const reactionSnapshot = await transaction.get(reactionQuery);
    const candidatesById = new Map<string, QueryDocumentSnapshot>();
    for (const document of relationSnapshot.docs) candidatesById.set(document.id, document);
    for (const document of reactionSnapshot.docs) candidatesById.set(document.id, document);
    const allCandidates = [...candidatesById.values()].sort(comparePendingOperationDocuments);
    const candidates = allCandidates.slice(0, PENDING_OPERATION_RESOLUTION_BATCH_SIZE);
    const appliedAt = new Date().toISOString();

    if (candidates.length === 0) {
      target.pendingOperationResolution = { status: 'completed', completedAt: appliedAt };
      transaction.set(targetRef, target);
      return 'completed';
    }

    const operationWrites: PrivateWhatsAppMessage[] = [];
    const contextChanges: PrivateWhatsAppContextChange[] = [];
    const chat: PrivateWhatsAppChat = { ...rawChat };

    for (const candidate of candidates) {
      const operation = toStoredPrivateWhatsAppMessage(candidate);
      const isOwnedOperation =
        operation.userId === input.userId &&
        operation.sourceAccountId === input.sourceAccountId &&
        operation.chatId === input.chatId;

      if (operation.messageType === 'reaction' && operation.reaction !== undefined) {
        if (
          operation.reaction.applicationStatus === 'applied' ||
          operation.reaction.applicationStatus === 'superseded'
        ) {
          continue;
        }
        const reactionSummary = toReactionSummary(operation, operation.reaction.emoji);
        const canApply =
          isOwnedOperation &&
          operation.contextState !== 'redacted' &&
          operation.contextState !== 'deleted' &&
          target.contextState !== 'redacted' &&
          target.contextState !== 'deleted' &&
          reactionSummary !== undefined;
        operation.reaction = {
          ...operation.reaction,
          targetMessageId: target.id,
          applicationStatus: canApply ? 'applied' : 'superseded',
          appliedAt,
        };
        operationWrites.push(operation);
        if (!canApply) continue;

        const before = toContextProjection(target);
        const reactions = sanitizeReactionSummaries([
          ...(target.reactions ?? []).filter((reaction) => reaction.id !== operation.id),
          reactionSummary,
        ]);
        const updatedTarget: PrivateWhatsAppMessage = { ...target, reactions };
        const after = toContextProjection(updatedTarget);
        if (!areJsonValuesEqual(before, after)) {
          const nextSequence = (chat.contextChangeSequence ?? 0) + 1;
          const nextRevision = (target.contextRevision ?? 1) + 1;
          updatedTarget.contextRevision = nextRevision;
          updatedTarget.contextChangeSequence = nextSequence;
          updatedTarget.contextState = 'visible';
          chat.contextChangeSequence = nextSequence;
          chat.contextChangedAt = appliedAt;
          contextChanges.push({
            userId: input.userId,
            sourceAccountId: input.sourceAccountId,
            chatId: input.chatId,
            sequence: nextSequence,
            messageId: target.id,
            messageRevision: nextRevision,
            changeType: 'reaction_changed',
            changedAt: appliedAt,
            eventTimestamp: target.eventTimestamp,
            before,
            after,
            schemaVersion: 1,
          });
        }
        target = updatedTarget;
        continue;
      }

      const operationRelation = operation.relation as NonNullable<
        PrivateWhatsAppMessage['relation']
      >;
      if (
        operationRelation.applicationStatus === 'applied' ||
        operationRelation.applicationStatus === 'superseded'
      ) {
        continue;
      }

      if (operationRelation.kind === 'replacement') {
        const replacementText = firstNonEmptyString(operation.text);
        const canApply =
          isOwnedOperation &&
          target.contextState !== 'redacted' &&
          target.contextState !== 'deleted' &&
          replacementText !== undefined &&
          isLaterContextOperation({
            candidateTimestamp: operation.eventTimestamp,
            candidateId: operation.id,
            currentTimestamp: target.latestReplacementEventTimestamp,
            currentId: target.latestReplacementMessageId,
          });
        operation.relation = {
          ...operationRelation,
          targetMessageId: target.id,
          applicationStatus: canApply ? 'applied' : 'superseded',
          appliedAt,
        };
        operationWrites.push(operation);
        if (!canApply) continue;

        const before = toContextProjection(target);
        const updatedTarget: PrivateWhatsAppMessage = {
          ...target,
          text: replacementText,
          ...originalContextTextFields(target),
          editedAt: operation.eventTimestamp,
          latestReplacementMessageId: operation.id,
          latestReplacementEventTimestamp: operation.eventTimestamp,
        };
        const after = toContextProjection(updatedTarget);
        if (!areJsonValuesEqual(before, after)) {
          const nextSequence = (chat.contextChangeSequence ?? 0) + 1;
          const nextRevision = (target.contextRevision ?? 1) + 1;
          updatedTarget.contextRevision = nextRevision;
          updatedTarget.contextChangeSequence = nextSequence;
          updatedTarget.contextState = 'visible';
          chat.contextChangeSequence = nextSequence;
          chat.contextChangedAt = appliedAt;
          contextChanges.push({
            userId: input.userId,
            sourceAccountId: input.sourceAccountId,
            chatId: input.chatId,
            sequence: nextSequence,
            messageId: target.id,
            messageRevision: nextRevision,
            changeType: 'edited',
            changedAt: appliedAt,
            eventTimestamp: target.eventTimestamp,
            before,
            after,
            schemaVersion: 1,
          });
        }
        target = updatedTarget;
        continue;
      }

      const canApply =
        isOwnedOperation &&
        target.contextState !== 'redacted' &&
        target.contextState !== 'deleted';
      operation.relation = {
        ...operationRelation,
        targetMessageId: target.id,
        applicationStatus: canApply ? 'applied' : 'superseded',
        appliedAt,
      };
      operationWrites.push(operation);
      if (!canApply) continue;

      const before = toContextProjection(target);
      const nextSequence = (chat.contextChangeSequence ?? 0) + 1;
      const nextRevision = (target.contextRevision ?? 1) + 1;
      target = createRedactedMessage({
        target,
        redactedAt: operation.eventTimestamp,
        contextRevision: nextRevision,
        contextChangeSequence: nextSequence,
      }) as StoredPrivateWhatsAppMessage;
      const after = toContextProjection(target);
      chat.contextChangeSequence = nextSequence;
      chat.contextChangedAt = appliedAt;
      contextChanges.push({
        userId: input.userId,
        sourceAccountId: input.sourceAccountId,
        chatId: input.chatId,
        sequence: nextSequence,
        messageId: target.id,
        messageRevision: nextRevision,
        changeType: 'redacted',
        changedAt: appliedAt,
        eventTimestamp: target.eventTimestamp,
        before,
        after,
        schemaVersion: 1,
      });
    }

    const lastCandidate = candidates[candidates.length - 1] as QueryDocumentSnapshot;
    const cursorEventTimestamp = readPendingOperationTimestamp(lastCandidate);
    const hasMore = allCandidates.length > PENDING_OPERATION_RESOLUTION_BATCH_SIZE;
    target.pendingOperationResolution = hasMore
      ? {
          status: 'pending',
          cursorEventTimestamp,
          cursorMessageId: lastCandidate.id,
        }
      : { status: 'completed', completedAt: appliedAt };

    transaction.set(targetRef, target);
    if (contextChanges.length > 0) transaction.set(chatRef, chat, { merge: true });
    for (const operation of operationWrites) {
      transaction.set(
        input.db.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(operation.id),
        operation
      );
    }
    for (const contextChange of contextChanges) {
      transaction.set(
        input.db
          .collection(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)
          .doc(createContextChangeId(input.chatId, contextChange.sequence)),
        contextChange
      );
    }
    return hasMore ? 'continue' : 'completed';
  });
}

function readPendingOperationCursor(
  target: StoredPrivateWhatsAppMessage
): PendingOperationCursor | undefined {
  const resolution = target.pendingOperationResolution;
  if (
    resolution?.status !== 'pending' ||
    resolution.cursorEventTimestamp === undefined ||
    resolution.cursorMessageId === undefined
  ) {
    return undefined;
  }
  return {
    eventTimestamp: resolution.cursorEventTimestamp,
    messageId: resolution.cursorMessageId,
  };
}

function comparePendingOperationDocuments(
  left: QueryDocumentSnapshot,
  right: QueryDocumentSnapshot
): number {
  const leftTimestamp = readPendingOperationTimestamp(left);
  const rightTimestamp = readPendingOperationTimestamp(right);
  const timestampComparison = leftTimestamp.localeCompare(rightTimestamp);
  return timestampComparison === 0 ? left.id.localeCompare(right.id) : timestampComparison;
}

function readPendingOperationTimestamp(document: QueryDocumentSnapshot): string {
  // Ingestion rejects missing/invalid timestamps, and Firestore orderBy excludes missing fields.
  return document.data()['eventTimestamp'] as string;
}

async function resolveChatForStore(
  db: FirestoreClient,
  transaction: FirestoreTransaction,
  input: StorePrivateWhatsAppMessageInput,
  senderKey: string
): Promise<PrivateChatResolution> {
  const roomChatId = createPrivateWhatsAppChatId(input.sourceAccountId, input.chat.matrixRoomId);
  const roomChatRef = db.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(roomChatId);
  const roomChatDoc = await transaction.get(roomChatRef);
  if (roomChatDoc.exists) {
    return { chatId: roomChatId };
  }

  if (input.chat.type !== 'direct') {
    return { chatId: roomChatId };
  }

  const aliasSnapshot = await transaction.get(
    db
      .collection(PRIVATE_WHATSAPP_CHATS_COLLECTION)
      .where('sourceAccountId', '==', input.sourceAccountId)
      .where('chatType', '==', 'direct')
      .where('matrixRoomIds', 'array-contains', input.chat.matrixRoomId)
      .limit(10)
  );
  const aliasChat = selectDirectChatCandidate(aliasSnapshot.docs);
  if (aliasChat !== undefined) {
    return { chatId: aliasChat.id };
  }

  if (input.message.direction !== 'incoming') {
    return { chatId: roomChatId };
  }

  const senderSnapshot = await transaction.get(
    db
      .collection(PRIVATE_WHATSAPP_CHATS_COLLECTION)
      .where('sourceAccountId', '==', input.sourceAccountId)
      .where('chatType', '==', 'direct')
      .where('participantKeys', 'array-contains', senderKey)
      .limit(10)
  );
  const senderChat = selectDirectChatCandidate(senderSnapshot.docs);
  if (senderChat !== undefined) {
    return { chatId: senderChat.id };
  }

  return { chatId: roomChatId };
}

function selectDirectChatCandidate(
  docs: QueryDocumentSnapshot[]
): QueryDocumentSnapshot | undefined {
  const candidates = [...docs].sort(compareDirectChatCandidates);
  return candidates[0];
}

function compareDirectChatCandidates(
  left: QueryDocumentSnapshot,
  right: QueryDocumentSnapshot
): number {
  const leftData = left.data() as Partial<PrivateWhatsAppChat>;
  const rightData = right.data() as Partial<PrivateWhatsAppChat>;
  const messageCountDifference =
    (readOptionalNumber(rightData.messageCount) ?? 0) -
    (readOptionalNumber(leftData.messageCount) ?? 0);
  if (messageCountDifference !== 0) {
    return messageCountDifference;
  }
  const firstSeenComparison = (leftData.firstSeenAt ?? '').localeCompare(
    rightData.firstSeenAt ?? ''
  );
  if (firstSeenComparison !== 0) {
    return firstSeenComparison;
  }
  return left.id.localeCompare(right.id);
}

async function getMessageById(
  messageId: string
): Promise<Result<PrivateWhatsAppMessage | null, WhatsAppError>> {
  try {
    const doc = await getFirestore()
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .doc(messageId)
      .get();
    if (!doc.exists) {
      return ok(null);
    }
    return ok(toPublicPrivateWhatsAppMessage(doc.id, doc.data()));
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to load private WhatsApp message: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function getChatById(input: {
  sourceAccountId: string;
  chatId: string;
}): Promise<Result<PrivateWhatsAppChat | null, WhatsAppError>> {
  try {
    const doc = await getFirestore()
      .collection(PRIVATE_WHATSAPP_CHATS_COLLECTION)
      .doc(input.chatId)
      .get();
    if (!doc.exists) {
      return ok(null);
    }
    const chat = normalizeChat(doc.id, doc.data());
    if (chat.sourceAccountId !== input.sourceAccountId) {
      return ok(null);
    }
    return ok(chat);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to load private WhatsApp chat: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function updateChatTranscriptionSetting(
  input: UpdatePrivateWhatsAppChatTranscriptionInput
): Promise<Result<PrivateWhatsAppChat, WhatsAppError>> {
  try {
    const db = getFirestore();
    const chatRef = db.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(input.chatId);
    const outcome = await db.runTransaction(
      async (
        transaction
      ): Promise<
        | { status: 'not_found' }
        | { status: 'fenced' }
        | { status: 'ok'; chat: PrivateWhatsAppChat }
      > => {
        const chatDoc = await transaction.get(chatRef);
        if (!chatDoc.exists) {
          return { status: 'not_found' };
        }

        const existingChat = normalizeChat(chatDoc.id, chatDoc.data());
        if (existingChat.sourceAccountId !== input.sourceAccountId) {
          return { status: 'not_found' };
        }
        if (
          await isPrivateWhatsAppMutationFenced(db, transaction, {
            userId: existingChat.userId,
            sourceAccountId: existingChat.sourceAccountId,
          })
        ) {
          return { status: 'fenced' };
        }

        const chat: PrivateWhatsAppChat = {
          ...existingChat,
          transcriptionEnabled: input.enabled,
          transcriptionUpdatedAt: input.now,
          updatedAt: input.now,
          schemaVersion: PRIVATE_WHATSAPP_SCHEMA_VERSION,
        };
        if (input.enabled && existingChat.transcriptionEnabledAt === undefined) {
          chat.transcriptionEnabledAt = input.now;
        } else if (existingChat.transcriptionEnabledAt !== undefined) {
          chat.transcriptionEnabledAt = existingChat.transcriptionEnabledAt;
        }

        transaction.set(chatRef, chat, { merge: true });
        return { status: 'ok', chat };
      }
    );

    if (outcome.status === 'not_found') {
      return err({ code: 'NOT_FOUND', message: 'Private WhatsApp chat not found' });
    }
    if (outcome.status === 'fenced') return mutationFencedError();
    return ok(outcome.chat);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to update private WhatsApp chat transcription setting: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function updateMessageTranscription(
  input: UpdatePrivateWhatsAppMessageTranscriptionInput
): Promise<Result<UpdatePrivateWhatsAppMessageTranscriptionResult, WhatsAppError>> {
  try {
    const db = getFirestore();
    const messageRef = db.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(input.messageId);
    const outcome = await db.runTransaction(
      async (
        transaction
      ): Promise<'not_found' | 'fenced' | UpdatePrivateWhatsAppMessageTranscriptionResult> => {
        const messageDoc = await transaction.get(messageRef);
        if (!messageDoc.exists) {
          return 'not_found';
        }

        const rawMessage = messageDoc.data() as Omit<PrivateWhatsAppMessage, 'id'> & {
          id?: string;
        };
        const message: PrivateWhatsAppMessage = {
          ...rawMessage,
          id: rawMessage.id ?? messageDoc.id,
        };
        if (message.userId !== input.userId) {
          return 'not_found';
        }
        if (
          await isPrivateWhatsAppMutationFenced(db, transaction, {
            userId: message.userId,
            ...(typeof message.sourceAccountId === 'string'
              ? { sourceAccountId: message.sourceAccountId }
              : {}),
          })
        ) {
          return 'fenced';
        }

        const hasJournalIdentity =
          typeof message.chatId === 'string' &&
          message.chatId.length > 0 &&
          typeof message.sourceAccountId === 'string' &&
          message.sourceAccountId.length > 0;
        if (!hasJournalIdentity) {
          const unchanged = areJsonValuesEqual(message.transcription, input.transcription);
          if (!unchanged) {
            transaction.update(messageRef, {
              transcription: input.transcription,
              schemaVersion: PRIVATE_WHATSAPP_SCHEMA_VERSION,
            });
          }
          return {
            status: unchanged ? 'unchanged' : 'updated',
            messageId: message.id,
          };
        }

        const chatRef = db.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(message.chatId);
        const chatDoc = await transaction.get(chatRef);
        if (!chatDoc.exists) {
          return 'not_found';
        }
        const chat = normalizeChat(chatDoc.id, chatDoc.data());
        if (chat.userId !== input.userId || chat.sourceAccountId !== message.sourceAccountId) {
          return 'not_found';
        }

        const before = toContextProjection(message);
        const updatedMessage: PrivateWhatsAppMessage = {
          ...message,
          transcription: input.transcription,
          schemaVersion: PRIVATE_WHATSAPP_SCHEMA_VERSION,
        };
        const after = toContextProjection(updatedMessage);
        const projectionChanged = !areJsonValuesEqual(before, after);
        if (!projectionChanged) {
          if (!areJsonValuesEqual(message.transcription, input.transcription)) {
            transaction.update(messageRef, {
              transcription: input.transcription,
              schemaVersion: PRIVATE_WHATSAPP_SCHEMA_VERSION,
            });
          }
          return {
            status: 'unchanged',
            messageId: message.id,
            chatId: message.chatId,
            contextRevision: message.contextRevision ?? 1,
            contextChangeSequence: message.contextChangeSequence ?? chat.contextChangeSequence ?? 0,
          };
        }

        const changedAt = new Date().toISOString();
        const contextRevision = (message.contextRevision ?? 1) + 1;
        const contextChangeSequence = (chat.contextChangeSequence ?? 0) + 1;
        const contextChange: PrivateWhatsAppContextChange = {
          userId: message.userId,
          sourceAccountId: message.sourceAccountId,
          chatId: message.chatId,
          sequence: contextChangeSequence,
          messageId: message.id,
          messageRevision: contextRevision,
          changeType: 'transcription_changed',
          changedAt,
          eventTimestamp: message.eventTimestamp,
          before,
          after,
          schemaVersion: 1,
        };
        const contextChangeRef = db
          .collection(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)
          .doc(createContextChangeId(message.chatId, contextChangeSequence));

        transaction.update(messageRef, {
          transcription: input.transcription,
          contextRevision,
          contextChangeSequence,
          schemaVersion: PRIVATE_WHATSAPP_SCHEMA_VERSION,
        });
        transaction.update(chatRef, {
          contextChangeSequence,
          contextChangedAt: changedAt,
        });
        transaction.set(contextChangeRef, contextChange);
        return {
          status: 'updated',
          messageId: message.id,
          chatId: message.chatId,
          contextRevision,
          contextChangeSequence,
        };
      }
    );

    if (outcome === 'not_found') {
      return err({ code: 'NOT_FOUND', message: 'Private WhatsApp message not found' });
    }
    if (outcome === 'fenced') return mutationFencedError();
    return ok(outcome);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to update private WhatsApp message transcription: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function updateMessageStoredMedia(
  input: UpdatePrivateWhatsAppMessageStoredMediaInput
): Promise<Result<UpdatePrivateWhatsAppMessageStoredMediaResult, WhatsAppError>> {
  if (input.media.storageStatus !== 'stored' || input.media.gcsPath === undefined) {
    return err({
      code: 'VALIDATION_ERROR',
      message: 'Stored private WhatsApp media requires a storage status and GCS path',
    });
  }

  try {
    const db = getFirestore();
    const messageRef = db.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(input.messageId);
    const outcome = await db.runTransaction(
      async (
        transaction
      ): Promise<
        | { status: 'not_found' }
        | { status: 'fenced' }
        | { status: 'validation_error'; message: string }
        | UpdatePrivateWhatsAppMessageStoredMediaResult
      > => {
        const messageDoc = await transaction.get(messageRef);
        if (!messageDoc.exists) {
          return { status: 'not_found' };
        }

        const rawMessage = messageDoc.data() as Omit<PrivateWhatsAppMessage, 'id'> & { id?: string };
        const existingMessage: PrivateWhatsAppMessage = {
          ...rawMessage,
          id: rawMessage.id ?? messageDoc.id,
        };
        if (existingMessage.sourceAccountId !== input.sourceAccountId) {
          return { status: 'not_found' };
        }
        if (
          await isPrivateWhatsAppMutationFenced(db, transaction, {
            userId: existingMessage.userId,
            sourceAccountId: existingMessage.sourceAccountId,
          })
        ) {
          return { status: 'fenced' };
        }
        if (existingMessage.media === undefined) {
          return {
            status: 'validation_error',
            message: 'Private WhatsApp message does not contain media metadata',
          };
        }
        if (existingMessage.media.mxcUri !== input.media.mxcUri) {
          return {
            status: 'validation_error',
            message: 'Stored private WhatsApp media does not match the message media id',
          };
        }

        const chatRef = db.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(existingMessage.chatId);
        const chatDoc = await transaction.get(chatRef);
        if (!chatDoc.exists) {
          return { status: 'not_found' };
        }
        const chat = normalizeChat(chatDoc.id, chatDoc.data());
        if (chat.sourceAccountId !== input.sourceAccountId) {
          return { status: 'not_found' };
        }

        if (existingMessage.media.gcsPath !== undefined) {
          if (existingMessage.media.gcsPath === input.media.gcsPath) {
            return {
              status: 'already_stored',
              message: existingMessage,
              chat,
            };
          }
          return {
            status: 'validation_error',
            message: 'Private WhatsApp message already references different stored media',
          };
        }

        const media: PrivateWhatsAppMessage['media'] = {
          ...existingMessage.media,
          ...input.media,
          storageStatus: 'stored',
        };
        const updatedMessage: PrivateWhatsAppMessage = {
          ...existingMessage,
          media,
          schemaVersion: PRIVATE_WHATSAPP_SCHEMA_VERSION,
        };
        transaction.update(messageRef, {
          media,
          schemaVersion: PRIVATE_WHATSAPP_SCHEMA_VERSION,
        });

        return {
          status: 'updated',
          message: updatedMessage,
          chat,
        };
      }
    );

    if (outcome.status === 'not_found') {
      return err({ code: 'NOT_FOUND', message: 'Private WhatsApp message not found' });
    }
    if (outcome.status === 'fenced') return mutationFencedError();
    if (outcome.status === 'validation_error') {
      return err({ code: 'VALIDATION_ERROR', message: outcome.message });
    }
    return ok(outcome);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to update private WhatsApp stored media: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function getConversationContextJournalHead(
  input: PrivateWhatsAppOwnedChatInput
): Promise<Result<number, WhatsAppError>> {
  const ownedChat = await getOwnedContextChat(input);
  if (!ownedChat.ok) return ownedChat;
  return ok(ownedChat.value.contextChangeSequence ?? 0);
}

async function findConversationContextJournalEntries(
  input: PrivateWhatsAppContextJournalQueryInput
): Promise<Result<PrivateWhatsAppContextJournalQueryResult, WhatsAppError>> {
  if (
    !Number.isInteger(input.afterSequence) ||
    input.afterSequence < 0 ||
    !Number.isInteger(input.throughSequence) ||
    input.throughSequence < input.afterSequence ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 400
  ) {
    return err({ code: 'VALIDATION_ERROR', message: 'Invalid private WhatsApp journal range' });
  }

  const ownedChat = await getOwnedContextChat(input);
  if (!ownedChat.ok) return ownedChat;

  try {
    const snapshot = await getFirestore()
      .collection(PRIVATE_WHATSAPP_CONTEXT_CHANGES_COLLECTION)
      .where('sourceAccountId', '==', input.sourceAccountId)
      .where('chatId', '==', input.chatId)
      .where('sequence', '>', input.afterSequence)
      .where('sequence', '<=', input.throughSequence)
      .orderBy('sequence', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(input.limit + 1)
      .get();
    const entries = snapshot.docs
      .slice(0, input.limit)
      .map((doc) => doc.data() as PrivateWhatsAppContextChange);
    const result: PrivateWhatsAppContextJournalQueryResult = { entries };
    if (snapshot.docs.length > input.limit) {
      const lastEntry = entries[entries.length - 1] as PrivateWhatsAppContextChange;
      result.nextAfterSequence = lastEntry.sequence;
    }
    return ok(result);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to query private WhatsApp context journal: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function findConversationContextMessagesByIds(
  input: PrivateWhatsAppContextMessagesByIdsInput
): Promise<Result<PrivateWhatsAppMessage[], WhatsAppError>> {
  if (input.messageIds.length > 400) {
    return err({
      code: 'VALIDATION_ERROR',
      message: 'Private WhatsApp context hydration accepts at most 400 message ids',
    });
  }

  const ownedChat = await getOwnedContextChat(input);
  if (!ownedChat.ok) return ownedChat;

  try {
    const messageIds = [...new Set(input.messageIds)];
    const snapshots = await Promise.all(
      messageIds.map((messageId) =>
        getFirestore().collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(messageId).get()
      )
    );
    const messages = snapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => {
        return toPublicPrivateWhatsAppMessage(snapshot.id, snapshot.data());
      })
      .filter(
        (message) =>
          message.sourceAccountId === input.sourceAccountId && message.chatId === input.chatId
      )
      .sort(compareContextMessages);
    return ok(messages);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to hydrate private WhatsApp context messages: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function getOwnedContextChat(
  input: PrivateWhatsAppOwnedChatInput
): Promise<Result<PrivateWhatsAppChat, WhatsAppError>> {
  const result = await getChatById(input);
  if (!result.ok) return result;
  if (result.value?.userId !== input.userId) {
    return err({ code: 'NOT_FOUND', message: 'Private WhatsApp chat not found' });
  }
  return ok(result.value);
}

function compareContextMessages(
  left: PrivateWhatsAppMessage,
  right: PrivateWhatsAppMessage
): number {
  const timestampComparison = left.eventTimestamp.localeCompare(right.eventTimestamp);
  return timestampComparison === 0 ? left.id.localeCompare(right.id) : timestampComparison;
}

async function findMessages(
  input: PrivateWhatsAppMessageQueryInput
): Promise<Result<PrivateWhatsAppMessageQueryResult, WhatsAppError>> {
  try {
    const db = getFirestore();
    let query: Query = db
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .where('sourceAccountId', '==', input.sourceAccountId);

    if (input.chatId !== undefined) {
      query = query.where('chatId', '==', input.chatId);
    }
    if (input.senderKey !== undefined) {
      query = query.where('senderKey', '==', input.senderKey);
    }
    if (input.eventDayKey !== undefined) {
      query = query.where('eventDayKey', '==', input.eventDayKey);
    }
    if (input.from !== undefined) {
      query = query.where('eventTimestamp', '>=', input.from);
    }
    if (input.to !== undefined) {
      query = query.where('eventTimestamp', '<', input.to);
    }
    query = query.orderBy('eventTimestamp', 'desc').orderBy(FieldPath.documentId(), 'desc');
    const cursor = decodeCursor(input.cursor);
    if (cursor !== undefined) {
      query = query.startAfter(cursor.sortValue, cursor.id);
    }

    const snapshot = await query.limit(input.limit + 1).get();
    const docs = snapshot.docs.slice(0, input.limit);
    const messages = docs.map((doc) => toPublicPrivateWhatsAppMessage(doc.id, doc.data()));
    const result: PrivateWhatsAppMessageQueryResult = { messages };
    if (snapshot.docs.length > input.limit) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage !== undefined) {
        result.nextCursor = encodeCursor(lastMessage.eventTimestamp, lastMessage.id);
      }
    }
    return ok(result);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to query private WhatsApp messages: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function findReactionsForMessageIds(
  input: PrivateWhatsAppReactionQueryInput
): Promise<Result<PrivateWhatsAppReactionQueryResult, WhatsAppError>> {
  try {
    if (input.targets.length === 0) {
      return ok({ reactionsByMessageId: {}, attachedReactionMessageIds: [] });
    }

    const targetMessageIds = Array.from(
      new Set(
        input.targets.map((target) => target.messageId)
      )
    );
    const targetsByMatrixEventId = new Map<string, string>();
    for (const target of input.targets) {
      targetsByMatrixEventId.set(target.matrixEventId, target.messageId);
    }
    const targetMessageIdSet = new Set(targetMessageIds);
    const targetMatrixEventIds = [...targetsByMatrixEventId.keys()];
    const reactionsByMessageId = new Map<string, PrivateWhatsAppReactionSummary[]>();
    const attachedReactionMessageIds = new Set<string>();

    for (const chunk of chunkMessageIds(targetMessageIds)) {
      let query: Query = getFirestore()
        .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
        .where('sourceAccountId', '==', input.sourceAccountId)
        .where('messageType', '==', 'reaction')
        .where('reaction.targetMessageId', 'in', chunk)
        .orderBy('eventTimestamp', 'asc')
        .orderBy(FieldPath.documentId(), 'asc');

      if (input.chatId !== undefined) {
        query = query.where('chatId', '==', input.chatId);
      }

      const snapshot = await query.get();
      for (const doc of snapshot.docs) {
        const message = toPrivateWhatsAppMessage(doc);
        const targetMessageId = message.reaction?.targetMessageId;
        /* v8 ignore start -- upstream: Firestore reaction.targetMessageId in-query only returns requested target ids; guard protects corrupt snapshots @preserve */
        if (targetMessageId === undefined || !targetMessageIdSet.has(targetMessageId)) {
          continue;
        }
        /* v8 ignore stop @preserve */

        addReactionSummary({
          reactionsByMessageId,
          attachedReactionMessageIds,
          message,
          targetMessageId,
          emoji: message.reaction?.emoji,
        });
      }
    }

    for (const chunk of chunkMessageIds(targetMatrixEventIds)) {
      let query: Query = getFirestore()
        .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
        .where('sourceAccountId', '==', input.sourceAccountId)
        .where('messageType', '==', 'reaction')
        .where(LEGACY_REACTION_TARGET_MATRIX_EVENT_ID_FIELD, 'in', chunk)
        .orderBy('eventTimestamp', 'asc')
        .orderBy(FieldPath.documentId(), 'asc');

      if (input.chatId !== undefined) {
        query = query.where('chatId', '==', input.chatId);
      }

      const snapshot = await query.get();
      for (const doc of snapshot.docs) {
        const message = toPrivateWhatsAppMessage(doc);
        const normalizedTargetMessageId =
          message.reaction === undefined ? undefined : message.reaction.targetMessageId;
        if (normalizedTargetMessageId !== undefined) {
          continue;
        }

        const legacyReaction = extractLegacyReaction(message.rawMatrixEvent);
        if (legacyReaction === undefined) {
          continue;
        }
        const targetMessageId = targetsByMatrixEventId.get(legacyReaction.targetMatrixEventId);
        /* v8 ignore start -- upstream: Firestore legacy target in-query guarantees requested Matrix event ids; guard protects corrupt snapshots @preserve */
        if (targetMessageId === undefined) {
          continue;
        }
        /* v8 ignore stop @preserve */

        addReactionSummary({
          reactionsByMessageId,
          attachedReactionMessageIds,
          message,
          targetMessageId,
          emoji: legacyReaction.emoji,
        });
      }
    }

    const result: PrivateWhatsAppReactionQueryResult = {
      reactionsByMessageId: {},
      attachedReactionMessageIds: [...attachedReactionMessageIds].sort((left, right) =>
        left.localeCompare(right)
      ),
    };
    for (const [messageId, summaries] of reactionsByMessageId.entries()) {
      result.reactionsByMessageId[messageId] = [...summaries].sort(compareReactionSummaries);
    }
    return ok(result);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to query private WhatsApp reactions: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function findConversationContextMessages(
  input: PrivateConversationContextMessageQueryInput
): Promise<Result<PrivateWhatsAppConversationContextMessageResult, WhatsAppError>> {
  try {
    let query: Query = getFirestore()
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .where('sourceAccountId', '==', input.sourceAccountId)
      .where('chatId', '==', input.chatId)
      .where('eventTimestamp', '>=', input.from)
      .where('eventTimestamp', '<', input.to)
      .orderBy('eventTimestamp', 'asc')
      .orderBy(FieldPath.documentId(), 'asc');
    const cursor = decodeCursor(input.cursor);
    if (cursor !== undefined) {
      query = query.startAfter(cursor.sortValue, cursor.id);
    }
    const [snapshot, countSnapshot] = await Promise.all([
      query.limit(input.limit + 1).get(),
      getFirestore()
        .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
        .where('sourceAccountId', '==', input.sourceAccountId)
        .where('chatId', '==', input.chatId)
        .where('eventTimestamp', '>=', input.from)
        .where('eventTimestamp', '<', input.to)
        .count()
        .get(),
    ]);
    const docs = snapshot.docs.slice(0, input.limit);
    const messages = docs.map((doc) => toPublicPrivateWhatsAppMessage(doc.id, doc.data()));
    const result: PrivateWhatsAppConversationContextMessageResult = {
      messages,
      totalCount: countSnapshot.data().count,
    };
    if (snapshot.docs.length > input.limit) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage !== undefined) {
        result.nextCursor = encodeCursor(lastMessage.eventTimestamp, lastMessage.id);
      }
    }
    return ok(result);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to query private WhatsApp conversation context messages: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function findChats(
  input: PrivateWhatsAppChatQueryInput
): Promise<Result<PrivateWhatsAppChatQueryResult, WhatsAppError>> {
  try {
    const db = getFirestore();
    let query: Query = db
      .collection(PRIVATE_WHATSAPP_CHATS_COLLECTION)
      .where('sourceAccountId', '==', input.sourceAccountId)
      .orderBy('lastEventAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    const cursor = decodeCursor(input.cursor);
    if (cursor !== undefined) {
      query = query.startAfter(cursor.sortValue, cursor.id);
    }

    const snapshot = await query.limit(input.limit + 1).get();
    const docs = snapshot.docs.slice(0, input.limit);
    const chats = docs.map((doc) => normalizeChat(doc.id, doc.data()));
    const result: PrivateWhatsAppChatQueryResult = { chats };
    /* v8 ignore start -- schema: cursor generation is covered through public reads; zero-limit guard is defensive for malformed internal callers @preserve */
    if (snapshot.docs.length > input.limit && input.limit > 0) {
      const lastChat = chats[chats.length - 1] as PrivateWhatsAppChat;
      result.nextCursor = encodeCursor(lastChat.lastEventAt, lastChat.id);
    }
    /* v8 ignore stop @preserve */
    return ok(result);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to query private WhatsApp chats: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function findSenders(
  input: PrivateWhatsAppSenderQueryInput
): Promise<Result<PrivateWhatsAppSenderQueryResult, WhatsAppError>> {
  try {
    const db = getFirestore();
    let query: Query = db
      .collection(PRIVATE_WHATSAPP_SENDERS_COLLECTION)
      .where('sourceAccountId', '==', input.sourceAccountId)
      .orderBy('lastEventAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    const cursor = decodeCursor(input.cursor);
    if (cursor !== undefined) {
      query = query.startAfter(cursor.sortValue, cursor.id);
    }

    const snapshot = await query.limit(input.limit + 1).get();
    const docs = snapshot.docs.slice(0, input.limit);
    const senders = docs.map((doc) => doc.data() as PrivateWhatsAppSender);
    const result: PrivateWhatsAppSenderQueryResult = { senders };
    if (snapshot.docs.length > input.limit) {
      const lastSender = senders[senders.length - 1];
      if (lastSender !== undefined) {
        result.nextCursor = encodeCursor(lastSender.lastEventAt, lastSender.id);
      }
    }
    return ok(result);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to query private WhatsApp senders: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function findSenderDays(
  input: PrivateWhatsAppSenderDayQueryInput
): Promise<Result<PrivateWhatsAppSenderDayQueryResult, WhatsAppError>> {
  try {
    const db = getFirestore();
    let query: Query = db
      .collection(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION)
      .where('sourceAccountId', '==', input.sourceAccountId);

    if (input.senderKey !== undefined) {
      query = query.where('senderKey', '==', input.senderKey);
    }
    if (input.fromDay !== undefined) {
      query = query.where('eventDayKey', '>=', input.fromDay);
    }
    if (input.toDay !== undefined) {
      query = query.where('eventDayKey', '<=', input.toDay);
    }
    query = query.orderBy('eventDayKey', 'desc');
    if (input.senderKey === undefined) {
      query = query.orderBy('senderKey', 'asc');
    }

    const cursor = decodeCursor(input.cursor);
    if (cursor !== undefined && input.senderKey === undefined) {
      query = query.startAfter(cursor.sortValue, cursor.id);
    } else if (cursor !== undefined) {
      query = query.startAfter(cursor.sortValue);
    }

    const snapshot = await query.limit(input.limit + 1).get();
    const docs = snapshot.docs.slice(0, input.limit);
    const senderDays = docs.map((doc) => doc.data() as PrivateWhatsAppSenderDay);
    const result: PrivateWhatsAppSenderDayQueryResult = { senderDays };
    if (snapshot.docs.length > input.limit) {
      const lastSenderDay = senderDays[senderDays.length - 1];
      if (lastSenderDay !== undefined) {
        result.nextCursor = encodeCursor(lastSenderDay.eventDayKey, lastSenderDay.senderKey);
      }
    }
    return ok(result);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to query private WhatsApp sender days: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

async function rebuildAggregates(
  input: PrivateWhatsAppAggregateRebuildInput
): Promise<Result<PrivateWhatsAppAggregateRebuildResult, WhatsAppError>> {
  try {
    const db = getFirestore();
    const outcome = await db.runTransaction(async (transaction) => {
      if (
        await isPrivateWhatsAppMutationFenced(db, transaction, {
          sourceAccountId: input.sourceAccountId,
        })
      ) {
        return { status: 'fenced' as const };
      }

      let messageQuery: Query = db
        .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
        .where('sourceAccountId', '==', input.sourceAccountId);
      if (input.from !== undefined) {
        messageQuery = messageQuery.where('eventTimestamp', '>=', input.from);
      }
      if (input.to !== undefined) {
        messageQuery = messageQuery.where('eventTimestamp', '<', input.to);
      }

      const messageSnapshot = await transaction.get(
        messageQuery.orderBy('eventTimestamp', 'asc').limit(input.limit)
      );
      const existingSenders = await transaction.get(
        db
          .collection(PRIVATE_WHATSAPP_SENDERS_COLLECTION)
          .where('sourceAccountId', '==', input.sourceAccountId)
      );
      const existingSenderDays = await transaction.get(
        db
          .collection(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION)
          .where('sourceAccountId', '==', input.sourceAccountId)
      );
      const senders = new Map<string, PrivateWhatsAppSender>();
      const senderDays = new Map<string, PrivateWhatsAppSenderDay>();
      const messageUpgrades: {
        messageId: string;
        fields: Partial<PrivateWhatsAppMessage>;
      }[] = [];

      for (const doc of messageSnapshot.docs) {
        const rawMessage = doc.data() as Omit<PrivateWhatsAppMessage, 'id'> & { id?: string };
        const message: PrivateWhatsAppMessage = { ...rawMessage, id: rawMessage.id ?? doc.id };
        const storeInput = toStoreInputFromMessage(message);
        const chatId =
          typeof message.chatId === 'string'
            ? message.chatId
            : createPrivateWhatsAppChatId(message.sourceAccountId, message.matrixRoomId);
        const senderKey = getSenderKey(storeInput);
        const eventDayKey = getEventDayKey(storeInput);
        const senderId = createPrivateWhatsAppSenderId(storeInput.sourceAccountId, senderKey);
        const senderDayId = createPrivateWhatsAppSenderDayId(
          storeInput.sourceAccountId,
          senderKey,
          eventDayKey
        );

        const sender = buildSender(storeInput, senderId, chatId, senders.get(senderId));
        senders.set(senderId, sender);
        senderDays.set(
          senderDayId,
          buildSenderDay(
            storeInput,
            senderDayId,
            chatId,
            senderDays.get(senderDayId),
            sender.senderDisplayName
          )
        );

        const upgradeFields = buildMessageUpgradeFields(message, storeInput);
        if (upgradeFields !== undefined) {
          messageUpgrades.push({ messageId: doc.id, fields: upgradeFields });
        }
      }

      for (const doc of existingSenders.docs) {
        transaction.delete(doc.ref);
      }
      for (const doc of existingSenderDays.docs) {
        transaction.delete(doc.ref);
      }
      for (const upgrade of messageUpgrades) {
        transaction.set(
          db.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(upgrade.messageId),
          upgrade.fields,
          { merge: true }
        );
      }
      for (const [senderId, sender] of senders.entries()) {
        transaction.set(db.collection(PRIVATE_WHATSAPP_SENDERS_COLLECTION).doc(senderId), sender);
      }
      for (const [senderDayId, senderDay] of senderDays.entries()) {
        transaction.set(
          db.collection(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION).doc(senderDayId),
          senderDay
        );
      }

      return {
        status: 'ok' as const,
        result: {
          scannedMessages: messageSnapshot.docs.length,
          upgradedMessages: messageUpgrades.length,
          senderCount: senders.size,
          senderDayCount: senderDays.size,
        },
      };
    });
    if (outcome.status === 'fenced') return mutationFencedError();
    return ok(outcome.result);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to rebuild private WhatsApp aggregates: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

function buildChat(
  input: StorePrivateWhatsAppMessageInput,
  chatId: string,
  existingChat: PrivateWhatsAppChat | undefined
): PrivateWhatsAppChat {
  const now = new Date().toISOString();
  const shouldApplyIncomingChatMetadata = isSameOrNewerChatEvent(
    existingChat,
    input.message.eventTimestamp
  ) && isPrimaryChatMatrixRoom(existingChat, input.chat.matrixRoomId);
  const chat: PrivateWhatsAppChat = {
    id: chatId,
    userId: input.userId,
    sourceAccountId: input.sourceAccountId,
    matrixRoomId: existingChat?.matrixRoomId ?? input.chat.matrixRoomId,
    chatType: selectChatType(existingChat, input.chat.type, shouldApplyIncomingChatMetadata),
    messageCount: (existingChat?.messageCount ?? 0) + 1,
    firstSeenAt: oldestTimestamp(existingChat?.firstSeenAt, input.message.eventTimestamp),
    lastEventAt: newestTimestamp(existingChat?.lastEventAt, input.message.eventTimestamp),
    updatedAt: now,
    schemaVersion: PRIVATE_WHATSAPP_SCHEMA_VERSION,
  };
  const participantKeys = appendUnique(existingChat?.participantKeys ?? [], getSenderKey(input));
  chat.participantKeys = participantKeys;
  chat.participantCount = participantKeys.length;
  chat.matrixRoomIds = appendUnique(getChatMatrixRoomIds(existingChat), input.chat.matrixRoomId);

  if (
    input.chat.displayName !== undefined &&
    (shouldApplyIncomingChatMetadata || existingChat?.displayName === undefined)
  ) {
    chat.displayName = input.chat.displayName;
  } else if (existingChat?.displayName !== undefined) {
    chat.displayName = existingChat.displayName;
  }
  if (
    input.chat.avatarMxcUri !== undefined &&
    (shouldApplyIncomingChatMetadata || existingChat?.avatarMxcUri === undefined)
  ) {
    chat.avatarMxcUri = input.chat.avatarMxcUri;
  } else if (existingChat?.avatarMxcUri !== undefined) {
    chat.avatarMxcUri = existingChat.avatarMxcUri;
  }
  if (existingChat?.transcriptionEnabled !== undefined) {
    chat.transcriptionEnabled = existingChat.transcriptionEnabled;
  }
  if (existingChat?.transcriptionEnabledAt !== undefined) {
    chat.transcriptionEnabledAt = existingChat.transcriptionEnabledAt;
  }
  if (existingChat?.transcriptionUpdatedAt !== undefined) {
    chat.transcriptionUpdatedAt = existingChat.transcriptionUpdatedAt;
  }
  if (existingChat?.contextChangeSequence !== undefined) {
    chat.contextChangeSequence = existingChat.contextChangeSequence;
  }
  if (existingChat?.contextChangedAt !== undefined) {
    chat.contextChangedAt = existingChat.contextChangedAt;
  }

  return chat;
}

function selectChatType(
  existingChat: PrivateWhatsAppChat | undefined,
  nextChatType: StorePrivateWhatsAppMessageInput['chat']['type'],
  shouldApplyIncomingChatMetadata: boolean
): PrivateWhatsAppChat['chatType'] {
  if (existingChat === undefined) {
    return nextChatType;
  }
  if (!shouldApplyIncomingChatMetadata) {
    return existingChat.chatType;
  }
  if (nextChatType === 'unknown' && existingChat.chatType !== 'unknown') {
    return existingChat.chatType;
  }
  if (existingChat.chatType === 'group' && nextChatType === 'direct') {
    return existingChat.chatType;
  }
  return nextChatType;
}

function isPrimaryChatMatrixRoom(
  existingChat: PrivateWhatsAppChat | undefined,
  matrixRoomId: string
): boolean {
  if (existingChat === undefined || existingChat.matrixRoomId === '') {
    return true;
  }
  return existingChat.matrixRoomId === matrixRoomId;
}

function getDirectChatDisplayName(chat: PrivateWhatsAppChat): string | undefined {
  return chat.chatType === 'direct' ? chat.displayName : undefined;
}

function buildSender(
  input: StorePrivateWhatsAppMessageInput,
  senderId: string,
  chatId: string,
  existingSender: PrivateWhatsAppSender | undefined,
  canonicalDisplayName?: string
): PrivateWhatsAppSender {
  const now = new Date().toISOString();
  const senderKey = getSenderKey(input);
  const sender: PrivateWhatsAppSender = {
    id: senderId,
    userId: input.userId,
    sourceAccountId: input.sourceAccountId,
    senderKey,
    firstEventAt: oldestTimestamp(existingSender?.firstEventAt, input.message.eventTimestamp),
    lastEventAt: newestTimestamp(existingSender?.lastEventAt, input.message.eventTimestamp),
    messageCount: (existingSender?.messageCount ?? 0) + 1,
    chatIds: appendUnique(existingSender?.chatIds ?? [], chatId),
    updatedAt: now,
    schemaVersion: PRIVATE_WHATSAPP_SCHEMA_VERSION,
  };

  const senderDisplayName = selectContactDisplayName(
    existingSender?.senderDisplayName,
    input.message.senderDisplayName,
    existingSender?.lastEventAt,
    input.message.eventTimestamp,
    canonicalDisplayName
  );
  if (senderDisplayName !== undefined) {
    sender.senderDisplayName = senderDisplayName;
  }

  const senderPhoneNumber = input.message.senderPhoneNumber ?? existingSender?.senderPhoneNumber;
  if (senderPhoneNumber !== undefined) {
    sender.senderPhoneNumber = senderPhoneNumber;
  }

  const senderPhoneNumberNormalized =
    getSenderPhoneNumberNormalized(input) ?? existingSender?.senderPhoneNumberNormalized;
  if (senderPhoneNumberNormalized !== undefined) {
    sender.senderPhoneNumberNormalized = senderPhoneNumberNormalized;
  }

  return sender;
}

function buildSenderDay(
  input: StorePrivateWhatsAppMessageInput,
  senderDayId: string,
  chatId: string,
  existingSenderDay: PrivateWhatsAppSenderDay | undefined,
  canonicalDisplayName?: string
): PrivateWhatsAppSenderDay {
  const now = new Date().toISOString();
  const senderDay: PrivateWhatsAppSenderDay = {
    id: senderDayId,
    userId: input.userId,
    sourceAccountId: input.sourceAccountId,
    senderKey: getSenderKey(input),
    eventDayKey: getEventDayKey(input),
    eventTimeZone: getEventTimeZone(input),
    firstEventAt: oldestTimestamp(existingSenderDay?.firstEventAt, input.message.eventTimestamp),
    lastEventAt: newestTimestamp(existingSenderDay?.lastEventAt, input.message.eventTimestamp),
    messageCount: (existingSenderDay?.messageCount ?? 0) + 1,
    chatIds: appendUnique(existingSenderDay?.chatIds ?? [], chatId),
    messageTypeCounts: incrementMessageTypeCount(
      existingSenderDay?.messageTypeCounts,
      input.message.type
    ),
    summaryStatus: 'not_started',
    summarySourceMessageCount: 0,
    updatedAt: now,
    schemaVersion: PRIVATE_WHATSAPP_SCHEMA_VERSION,
  };

  const senderDisplayName = selectContactDisplayName(
    existingSenderDay?.senderDisplayName,
    input.message.senderDisplayName,
    existingSenderDay?.lastEventAt,
    input.message.eventTimestamp,
    canonicalDisplayName
  );
  if (senderDisplayName !== undefined) {
    senderDay.senderDisplayName = senderDisplayName;
  }
  const senderPhoneNumber = input.message.senderPhoneNumber ?? existingSenderDay?.senderPhoneNumber;
  if (senderPhoneNumber !== undefined) {
    senderDay.senderPhoneNumber = senderPhoneNumber;
  }

  return senderDay;
}

function toStoreInputFromMessage(message: PrivateWhatsAppMessage): StorePrivateWhatsAppMessageInput {
  const senderPhoneNumberNormalized = getMessageSenderPhoneNumberNormalized(message);
  const senderKey =
    message.senderKey ??
    (senderPhoneNumberNormalized !== undefined
      ? `phone:+${senderPhoneNumberNormalized}`
      : `matrix:${message.matrixSenderId}`);
  const eventDayKey = message.eventDayKey ?? toWarsawDayKey(message.eventTimestamp);
  const eventTimeZone = message.eventTimeZone ?? PRIVATE_WHATSAPP_EVENT_TIME_ZONE;
  const chat: StorePrivateWhatsAppMessageInput['chat'] = {
    matrixRoomId: message.matrixRoomId,
    type: message.chatType ?? 'unknown',
  };
  if (message.chatDisplayName !== undefined) {
    chat.displayName = message.chatDisplayName;
  }

  const storeMessage: StorePrivateWhatsAppMessageInput['message'] = {
    matrixRoomId: message.matrixRoomId,
    matrixEventId: message.matrixEventId,
    matrixSenderId: message.matrixSenderId,
    senderKey,
    direction: message.direction,
    type: isPrivateWhatsAppMessageType(message.messageType) ? message.messageType : 'unknown',
    eventTimestamp: message.eventTimestamp,
    eventDayKey,
    eventTimeZone,
    rawMatrixEvent: message.rawMatrixEvent,
  };
  if (message.senderDisplayName !== undefined) {
    storeMessage.senderDisplayName = message.senderDisplayName;
  }
  if (message.senderPhoneNumber !== undefined) {
    storeMessage.senderPhoneNumber = message.senderPhoneNumber;
  }
  if (senderPhoneNumberNormalized !== undefined) {
    storeMessage.senderPhoneNumberNormalized = senderPhoneNumberNormalized;
  }
  if (message.text !== undefined) {
    storeMessage.text = message.text;
  }
  if (message.media !== undefined) {
    storeMessage.media = message.media;
  }
  if (message.reaction !== undefined) {
    storeMessage.reaction = {
      emoji: message.reaction.emoji,
      targetMatrixEventId: message.reaction.targetMatrixEventId,
    };
  }

  return {
    sourceAccountId: message.sourceAccountId,
    userId: message.userId,
    deliveryMode: message.deliveryMode,
    receivedAt: message.receivedAt,
    chat,
    message: storeMessage,
  };
}

function buildMessageUpgradeFields(
  message: PrivateWhatsAppMessage,
  input: StorePrivateWhatsAppMessageInput
): Partial<PrivateWhatsAppMessage> | undefined {
  const fields: Partial<PrivateWhatsAppMessage> = {};
  const senderKey = getSenderKey(input);
  const eventDayKey = getEventDayKey(input);
  const eventTimeZone = getEventTimeZone(input);
  const senderPhoneNumberNormalized = getSenderPhoneNumberNormalized(input);

  if (message.senderKey !== senderKey) {
    fields.senderKey = senderKey;
  }
  if (
    senderPhoneNumberNormalized !== undefined &&
    message.senderPhoneNumberNormalized !== senderPhoneNumberNormalized
  ) {
    fields.senderPhoneNumberNormalized = senderPhoneNumberNormalized;
  }
  if (message.eventDayKey !== eventDayKey) {
    fields.eventDayKey = eventDayKey;
  }
  if (message.eventTimeZone !== eventTimeZone) {
    fields.eventTimeZone = eventTimeZone;
  }
  if (message.chatType !== input.chat.type) {
    fields.chatType = input.chat.type;
  }
  if (message.schemaVersion !== PRIVATE_WHATSAPP_SCHEMA_VERSION) {
    fields.schemaVersion = PRIVATE_WHATSAPP_SCHEMA_VERSION;
  }

  return Object.keys(fields).length === 0 ? undefined : fields;
}

function chunkMessageIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += 30) {
    chunks.push(ids.slice(index, index + 30));
  }
  return chunks;
}

function addReactionSummary(input: {
  reactionsByMessageId: Map<string, PrivateWhatsAppReactionSummary[]>;
  attachedReactionMessageIds: Set<string>;
  message: PrivateWhatsAppMessage;
  targetMessageId: string;
  emoji: string | undefined;
}): void {
  const summary = toReactionSummary(input.message, input.emoji);
  if (summary === undefined) {
    return;
  }

  const existing = input.reactionsByMessageId.get(input.targetMessageId) ?? [];
  existing.push(summary);
  input.reactionsByMessageId.set(input.targetMessageId, existing);
  input.attachedReactionMessageIds.add(input.message.id);
}

function toReactionSummary(
  message: PrivateWhatsAppMessage,
  emoji: string | undefined
): PrivateWhatsAppReactionSummary | undefined {
  const normalizedEmoji = firstNonEmptyString(emoji) ?? firstNonEmptyString(message.text);
  if (normalizedEmoji === undefined) {
    return undefined;
  }

  return {
    id: message.id,
    emoji: normalizedEmoji,
    direction: message.direction,
    eventTimestamp: message.eventTimestamp,
    ...(message.senderKey !== undefined ? { senderKey: message.senderKey } : {}),
    ...(message.senderDisplayName !== undefined
      ? { senderDisplayName: message.senderDisplayName }
      : {}),
    ...(message.senderPhoneNumber !== undefined
      ? { senderPhoneNumber: message.senderPhoneNumber }
      : {}),
  };
}

function extractLegacyReaction(
  rawMatrixEvent: unknown
): { emoji: string; targetMatrixEventId: string } | undefined {
  /* v8 ignore start -- upstream: Firestore nested rawMatrixEvent target query cannot return non-record rawMatrixEvent parents @preserve */
  if (!isRecord(rawMatrixEvent)) {
    return undefined;
  }
  /* v8 ignore stop @preserve */
  const content = rawMatrixEvent['content'];
  /* v8 ignore start -- upstream: Firestore nested rawMatrixEvent target query cannot return non-record content parents @preserve */
  if (!isRecord(content)) {
    return undefined;
  }
  /* v8 ignore stop @preserve */
  const relatesTo = content['m.relates_to'];
  if (!isRecord(relatesTo) || relatesTo['rel_type'] !== 'm.annotation') {
    return undefined;
  }

  const targetMatrixEventId = firstNonEmptyString(asOptionalString(relatesTo['event_id']));
  const emoji = firstNonEmptyString(asOptionalString(relatesTo['key']));
  if (targetMatrixEventId === undefined || emoji === undefined) {
    return undefined;
  }
  return { emoji, targetMatrixEventId };
}

function compareReactionSummaries(
  left: PrivateWhatsAppReactionSummary,
  right: PrivateWhatsAppReactionSummary
): number {
  const timestampComparison = left.eventTimestamp.localeCompare(right.eventTimestamp);
  return timestampComparison === 0 ? left.id.localeCompare(right.id) : timestampComparison;
}

function toPrivateWhatsAppMessage(
  doc: QueryDocumentSnapshot
): Omit<PrivateWhatsAppMessage, 'id'> & { id: string } {
  return toPublicPrivateWhatsAppMessage(doc.id, doc.data());
}

function toPublicPrivateWhatsAppMessage(
  documentId: string,
  rawData: Record<string, unknown> | undefined
): PrivateWhatsAppMessage {
  const data = rawData as StoredPrivateWhatsAppMessageData;
  const { pendingOperationResolution: _pendingOperationResolution, ...publicData } = data;
  return { ...publicData, id: data.id ?? documentId };
}

function firstNonEmptyString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value.trim() === '' ? undefined : value;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* v8 ignore start -- schema: defensive Firestore chat projection fallbacks are only partially reachable through sourceAccountId-filtered queries @preserve */
function normalizeChat(id: string, data: Record<string, unknown> | undefined): PrivateWhatsAppChat {
  const chat = data as Partial<PrivateWhatsAppChat> | undefined;
  const projected: PrivateWhatsAppChat = {
    id,
    userId: typeof chat?.userId === 'string' ? chat.userId : '',
    sourceAccountId: typeof chat?.sourceAccountId === 'string' ? chat.sourceAccountId : '',
    matrixRoomId: typeof chat?.matrixRoomId === 'string' ? chat.matrixRoomId : '',
    chatType:
      chat?.chatType === 'direct' || chat?.chatType === 'group' || chat?.chatType === 'unknown'
        ? chat.chatType
        : 'unknown',
    firstSeenAt: typeof chat?.firstSeenAt === 'string' ? chat.firstSeenAt : '',
    lastEventAt: typeof chat?.lastEventAt === 'string' ? chat.lastEventAt : '',
    updatedAt: typeof chat?.updatedAt === 'string' ? chat.updatedAt : '',
    schemaVersion:
      typeof chat?.schemaVersion === 'number' ? chat.schemaVersion : PRIVATE_WHATSAPP_SCHEMA_VERSION,
  };
  if (typeof chat?.displayName === 'string') {
    projected.displayName = chat.displayName;
  }
  if (typeof chat?.avatarMxcUri === 'string') {
    projected.avatarMxcUri = chat.avatarMxcUri;
  }
  projected.matrixRoomIds = getChatMatrixRoomIds(chat);
  if (typeof chat?.messageCount === 'number') {
    projected.messageCount = chat.messageCount;
  }
  if (typeof chat?.participantCount === 'number') {
    projected.participantCount = chat.participantCount;
  }
  if (Array.isArray(chat?.participantKeys)) {
    projected.participantKeys = chat.participantKeys.filter(
      (participantKey): participantKey is string => typeof participantKey === 'string'
    );
    projected.participantCount = projected.participantCount ?? projected.participantKeys.length;
  }
  if (typeof chat?.transcriptionEnabled === 'boolean') {
    projected.transcriptionEnabled = chat.transcriptionEnabled;
  }
  if (typeof chat?.transcriptionEnabledAt === 'string') {
    projected.transcriptionEnabledAt = chat.transcriptionEnabledAt;
  }
  if (typeof chat?.transcriptionUpdatedAt === 'string') {
    projected.transcriptionUpdatedAt = chat.transcriptionUpdatedAt;
  }
  if (typeof chat?.contextChangeSequence === 'number') {
    projected.contextChangeSequence = chat.contextChangeSequence;
  }
  if (typeof chat?.contextChangedAt === 'string') {
    projected.contextChangedAt = chat.contextChangedAt;
  }
  return projected;
}
/* v8 ignore stop @preserve */

function getSenderKey(input: StorePrivateWhatsAppMessageInput): string {
  const senderPhoneNumberNormalized = getSenderPhoneNumberNormalized(input);
  if (senderPhoneNumberNormalized !== undefined) {
    return `phone:+${senderPhoneNumberNormalized}`;
  }
  return input.message.senderKey ?? `matrix:${input.message.matrixSenderId}`;
}

function getEventDayKey(input: StorePrivateWhatsAppMessageInput): string {
  return input.message.eventDayKey ?? toWarsawDayKey(input.message.eventTimestamp);
}

function getEventTimeZone(input: StorePrivateWhatsAppMessageInput): string {
  return input.message.eventTimeZone ?? PRIVATE_WHATSAPP_EVENT_TIME_ZONE;
}

function getSenderPhoneNumberNormalized(
  input: StorePrivateWhatsAppMessageInput
): string | undefined {
  return (
    input.message.senderPhoneNumberNormalized ??
    normalizeSenderPhoneNumber(input.message.senderPhoneNumber) ??
    extractPhoneNumberFromWhatsAppMatrixId(input.message.matrixSenderId)
  );
}

function getMessageSenderPhoneNumberNormalized(
  message: PrivateWhatsAppMessage
): string | undefined {
  return (
    message.senderPhoneNumberNormalized ??
    normalizeSenderPhoneNumber(message.senderPhoneNumber) ??
    extractPhoneNumberFromWhatsAppMatrixId(message.matrixSenderId)
  );
}

function normalizeSenderPhoneNumber(phoneNumber: string | undefined): string | undefined {
  if (phoneNumber === undefined) {
    return undefined;
  }
  const digits = phoneNumber.replace(/\D/g, '');
  return digits.length === 0 ? undefined : digits;
}

function extractPhoneNumberFromWhatsAppMatrixId(matrixSenderId: string): string | undefined {
  const match = /^@whatsapp_([0-9]+):/.exec(matrixSenderId);
  return match?.[1];
}

function isPrivateWhatsAppMessageType(value: string): value is PrivateWhatsAppMessage['messageType'] {
  return PRIVATE_WHATSAPP_MESSAGE_TYPES.has(value as PrivateWhatsAppMessage['messageType']);
}

function toWarsawDayKey(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp.slice(0, 10);
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRIVATE_WHATSAPP_EVENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  /* v8 ignore start -- upstream: Intl.DateTimeFormat requests year/month/day and always include those parts; fallback guard cannot be triggered by normal inputs @preserve */
  if (year === undefined || month === undefined || day === undefined) {
    return timestamp.slice(0, 10);
  }
  /* v8 ignore stop @preserve */
  return `${year}-${month}-${day}`;
}

function appendUnique(values: string[], nextValue: string): string[] {
  if (values.includes(nextValue)) {
    return values;
  }
  return [...values, nextValue];
}

function getChatMatrixRoomIds(chat: Partial<PrivateWhatsAppChat> | undefined): string[] {
  const matrixRoomIds = Array.isArray(chat?.matrixRoomIds)
    ? chat.matrixRoomIds.filter((matrixRoomId): matrixRoomId is string => typeof matrixRoomId === 'string')
    : [];
  if (typeof chat?.matrixRoomId !== 'string' || chat.matrixRoomId === '') {
    return matrixRoomIds;
  }
  return appendUnique(matrixRoomIds, chat.matrixRoomId);
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function selectLatestString(
  existingValue: string | undefined,
  nextValue: string | undefined,
  existingTimestamp: string | undefined,
  nextTimestamp: string
): string | undefined {
  if (nextValue === undefined) {
    return existingValue;
  }
  if (existingValue === undefined) {
    return nextValue;
  }
  if (existingTimestamp === undefined) {
    return nextValue;
  }
  return isSameOrNewerTimestamp(existingTimestamp, nextTimestamp) ? nextValue : existingValue;
}

function selectContactDisplayName(
  existingValue: string | undefined,
  nextValue: string | undefined,
  existingTimestamp: string | undefined,
  nextTimestamp: string,
  canonicalDisplayName?: string
): string | undefined {
  const latestValue = selectLatestString(existingValue, nextValue, existingTimestamp, nextTimestamp);
  const stableCanonical = isStableContactDisplayName(canonicalDisplayName)
    ? canonicalDisplayName
    : undefined;
  if (latestValue === undefined) {
    return stableCanonical;
  }
  if (isBridgeGeneratedContactLabel(latestValue)) {
    if (stableCanonical !== undefined) {
      return stableCanonical;
    }
    if (isStableContactDisplayName(existingValue)) {
      return existingValue;
    }
  }
  return latestValue;
}

function isStableContactDisplayName(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '' && !isBridgeGeneratedContactLabel(value);
}

function isBridgeGeneratedContactLabel(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.endsWith(' (WA)') || isPhoneLikeContactLabel(trimmed);
}

function isPhoneLikeContactLabel(value: string): boolean {
  const digitCount = value.replace(/\D/g, '').length;
  return digitCount >= 6 && /^[+\d\s().-]+$/.test(value);
}

function isSameOrNewerTimestamp(existingTimestamp: string, nextTimestamp: string): boolean {
  const existingMs = Date.parse(existingTimestamp);
  const nextMs = Date.parse(nextTimestamp);
  if (Number.isNaN(existingMs)) {
    return true;
  }
  if (Number.isNaN(nextMs)) {
    return false;
  }
  return nextMs >= existingMs;
}

function incrementMessageTypeCount(
  existingCounts: Partial<Record<PrivateWhatsAppMessage['messageType'], number>> | undefined,
  messageType: PrivateWhatsAppMessage['messageType']
): Partial<Record<PrivateWhatsAppMessage['messageType'], number>> {
  const counts: Partial<Record<PrivateWhatsAppMessage['messageType'], number>> = {
    ...(existingCounts ?? {}),
  };
  counts[messageType] = (counts[messageType] ?? 0) + 1;
  return counts;
}

interface QueryCursor {
  sortValue: string;
  id: string;
}

function encodeCursor(sortValue: string, id: string): string {
  return Buffer.from(JSON.stringify({ sortValue, id })).toString('base64url');
}

function decodeCursor(cursor: string | undefined): QueryCursor | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      sortValue?: unknown;
      id?: unknown;
    };
    if (typeof parsed.sortValue !== 'string' || typeof parsed.id !== 'string') {
      return undefined;
    }
    return { sortValue: parsed.sortValue, id: parsed.id };
  } catch {
    return undefined;
  }
}

function oldestTimestamp(existingTimestamp: string | undefined, nextTimestamp: string): string {
  if (existingTimestamp === undefined) {
    return nextTimestamp;
  }
  const existingMs = Date.parse(existingTimestamp);
  const nextMs = Date.parse(nextTimestamp);
  if (Number.isNaN(existingMs)) {
    return nextTimestamp;
  }
  if (Number.isNaN(nextMs)) {
    return existingTimestamp;
  }
  return nextMs < existingMs ? nextTimestamp : existingTimestamp;
}

function newestTimestamp(existingTimestamp: string | undefined, nextTimestamp: string): string {
  if (existingTimestamp === undefined) {
    return nextTimestamp;
  }
  const existingMs = Date.parse(existingTimestamp);
  const nextMs = Date.parse(nextTimestamp);
  if (Number.isNaN(existingMs)) {
    return nextTimestamp;
  }
  if (Number.isNaN(nextMs)) {
    return existingTimestamp;
  }
  return nextMs > existingMs ? nextTimestamp : existingTimestamp;
}

function isSameOrNewerChatEvent(
  existingChat: PrivateWhatsAppChat | undefined,
  nextTimestamp: string
): boolean {
  if (existingChat === undefined) {
    return true;
  }
  const existingMs = Date.parse(existingChat.lastEventAt);
  const nextMs = Date.parse(nextTimestamp);
  if (Number.isNaN(existingMs)) {
    return true;
  }
  if (Number.isNaN(nextMs)) {
    return false;
  }
  return nextMs >= existingMs;
}

function buildMessage(
  input: StorePrivateWhatsAppMessageInput,
  chatId: string,
  messageId: string,
  displayNames: PrivateWhatsAppMessageDisplayNames = {}
): PrivateWhatsAppMessage {
  const message: PrivateWhatsAppMessage = {
    id: messageId,
    chatId,
    userId: input.userId,
    sourceAccountId: input.sourceAccountId,
    matrixRoomId: input.message.matrixRoomId,
    matrixEventId: input.message.matrixEventId,
    matrixSenderId: input.message.matrixSenderId,
    senderKey: getSenderKey(input),
    direction: input.message.direction,
    messageType: input.message.type,
    eventTimestamp: input.message.eventTimestamp,
    eventDayKey: getEventDayKey(input),
    eventTimeZone: getEventTimeZone(input),
    chatType: input.chat.type,
    receivedAt: input.receivedAt,
    ingestedAt: new Date().toISOString(),
    deliveryMode: input.deliveryMode,
    rawMatrixEvent: input.message.rawMatrixEvent,
    schemaVersion: PRIVATE_WHATSAPP_SCHEMA_VERSION,
  };

  const senderDisplayName = displayNames.senderDisplayName ?? input.message.senderDisplayName;
  if (senderDisplayName !== undefined) {
    message.senderDisplayName = senderDisplayName;
  }
  if (input.message.senderPhoneNumber !== undefined) {
    message.senderPhoneNumber = input.message.senderPhoneNumber;
  }
  const senderPhoneNumberNormalized = getSenderPhoneNumberNormalized(input);
  if (senderPhoneNumberNormalized !== undefined) {
    message.senderPhoneNumberNormalized = senderPhoneNumberNormalized;
  }
  const chatDisplayName = displayNames.chatDisplayName ?? input.chat.displayName;
  if (chatDisplayName !== undefined) {
    message.chatDisplayName = chatDisplayName;
  }
  if (input.message.text !== undefined) {
    message.text = input.message.text;
  }
  if (input.message.media !== undefined) {
    message.media = input.message.media;
  }
  if (input.message.reaction !== undefined) {
    message.reaction = {
      emoji: input.message.reaction.emoji,
      targetMatrixEventId: input.message.reaction.targetMatrixEventId,
      targetMessageId: createPrivateWhatsAppMessageId(
        input.sourceAccountId,
        input.message.reaction.targetMatrixEventId
      ),
      applicationStatus: 'pending',
      ...(input.message.reaction.targetUnavailableReason === undefined
        ? {}
        : { targetUnavailableReason: input.message.reaction.targetUnavailableReason }),
    };
  }
  if (input.message.relation !== undefined) {
    message.relation = { ...input.message.relation };
  }

  return message;
}

function buildBackfillDuplicateOperationRepair(
  existing: Partial<StoredPrivateWhatsAppMessage> | undefined,
  input: StorePrivateWhatsAppMessageInput,
  expectedChatId: string
): Pick<StoredPrivateWhatsAppMessage, 'relation'> | Pick<StoredPrivateWhatsAppMessage, 'reaction'> | undefined {
  if (
    input.deliveryMode !== 'backfill' ||
    existing?.userId !== input.userId ||
    existing.sourceAccountId !== input.sourceAccountId ||
    existing.chatId !== expectedChatId ||
    existing.matrixEventId !== input.message.matrixEventId ||
    existing.matrixRoomId !== input.message.matrixRoomId ||
    existing.messageType !== input.message.type
  ) {
    return undefined;
  }

  const relation = input.message.relation;
  const reaction = input.message.reaction;
  const relationReason = input.message.relation?.targetUnavailableReason;
  const reactionReason = input.message.reaction?.targetUnavailableReason;
  if ((relation === undefined) === (reaction === undefined)) {
    return undefined;
  }
  const now = new Date().toISOString();

  if (relation !== undefined) {
    if (
      (relationReason !== undefined &&
        !REVIEWED_RELATION_TARGET_UNAVAILABLE_REASONS.has(relationReason)) ||
      (existing.relation !== undefined &&
        (existing.relation.kind !== relation.kind ||
          existing.relation.targetMatrixEventId !== relation.targetMatrixEventId)) ||
      (relationReason === undefined && existing.relation !== undefined)
    ) {
      return undefined;
    }
    return {
      relation: {
        kind: relation.kind,
        targetMatrixEventId: relation.targetMatrixEventId,
        targetMessageId: createPrivateWhatsAppMessageId(
          input.sourceAccountId,
          relation.targetMatrixEventId
        ),
        applicationStatus: 'superseded',
        ...(relationReason === undefined ? {} : { targetUnavailableReason: relationReason }),
        appliedAt: existing.relation?.appliedAt ?? now,
      },
    };
  }

  if (
    reaction === undefined ||
    (reactionReason !== undefined &&
      !REVIEWED_RELATION_TARGET_UNAVAILABLE_REASONS.has(reactionReason)) ||
    existing.messageType !== 'reaction' ||
    (existing.reaction !== undefined &&
      (existing.reaction.emoji !== reaction.emoji ||
        existing.reaction.targetMatrixEventId !== reaction.targetMatrixEventId)) ||
    (reactionReason === undefined && existing.reaction !== undefined)
  ) {
    return undefined;
  }
  return {
    reaction: {
      emoji: reaction.emoji,
      targetMatrixEventId: reaction.targetMatrixEventId,
      targetMessageId: createPrivateWhatsAppMessageId(
        input.sourceAccountId,
        reaction.targetMatrixEventId
      ),
      applicationStatus: 'superseded',
      ...(reactionReason === undefined ? {} : { targetUnavailableReason: reactionReason }),
      appliedAt: existing.reaction?.appliedAt ?? now,
    },
  };
}

function createContextChangeId(chatId: string, sequence: number): string {
  return createHash('sha256')
    .update(`private-whatsapp-context-change\0${chatId}\0${String(sequence)}`)
    .digest('hex');
}

function readStoredPrivateWhatsAppMessage(
  snapshot: PrivateWhatsAppMessageSnapshot | undefined
): StoredPrivateWhatsAppMessage | undefined {
  return snapshot?.exists === true ? toStoredPrivateWhatsAppMessage(snapshot) : undefined;
}

function toStoredPrivateWhatsAppMessage(
  snapshot: Pick<PrivateWhatsAppMessageSnapshot, 'id' | 'data'>
): StoredPrivateWhatsAppMessage {
  const data = snapshot.data() as StoredPrivateWhatsAppMessageData;
  return {
    ...data,
    id: data.id ?? snapshot.id,
  };
}

function originalContextTextFields(
  target: PrivateWhatsAppMessage
): Pick<PrivateWhatsAppMessage, 'contextOriginalText'> | Record<string, never> {
  const originalText = target.contextOriginalText ?? target.text;
  return originalText === undefined ? {} : { contextOriginalText: originalText };
}

function toContextProjection(message: PrivateWhatsAppMessage): PrivateWhatsAppContextProjection {
  const speakerLabel =
    message.direction === 'outgoing'
      ? 'You'
      : firstNonEmptyString(message.senderDisplayName) ?? 'Participant';
  const base = {
    eventTimestamp: message.eventTimestamp,
    importedAt: message.receivedAt,
    direction: message.direction,
    speakerLabel,
    messageType: message.messageType,
  };
  if (message.contextState === 'redacted' || message.contextState === 'deleted') {
    return {
      state: message.contextState,
      ...base,
    };
  }
  const text = firstNonEmptyString(message.text);
  if (text !== undefined) {
    return {
      state: 'included',
      ...base,
      contentKind: 'text',
      content: text,
      reactions: sanitizeReactionSummaries(message.reactions),
    };
  }
  const transcription = firstNonEmptyString(message.transcription?.text);
  if (message.transcription?.status === 'completed' && transcription !== undefined) {
    return {
      state: 'included',
      ...base,
      contentKind: 'transcription',
      content: transcription,
      reactions: sanitizeReactionSummaries(message.reactions),
    };
  }
  const omissionReason =
    message.transcription?.status === 'pending' || message.transcription?.status === 'processing'
      ? 'pending_transcription'
      : message.transcription?.status === 'failed'
        ? 'failed_transcription'
        : message.messageType === 'image' ||
            message.messageType === 'audio' ||
            message.messageType === 'video' ||
            message.messageType === 'file' ||
            message.messageType === 'sticker'
          ? 'media_only'
          : 'non_text';
  return {
    state: 'omitted',
    ...base,
    omissionReason,
    reactions: sanitizeReactionSummaries(message.reactions),
  };
}

function createRedactedMessage(input: {
  target: PrivateWhatsAppMessage;
  redactedAt: string;
  contextRevision: number;
  contextChangeSequence: number;
}): PrivateWhatsAppMessage {
  const {
    text: _text,
    media: _media,
    transcription: _transcription,
    reactions: _reactions,
    contextOriginalText: _contextOriginalText,
    latestReplacementMessageId: _latestReplacementMessageId,
    latestReplacementEventTimestamp: _latestReplacementEventTimestamp,
    rawMatrixEvent: _rawMatrixEvent,
    ...retained
  } = input.target;
  return {
    ...retained,
    contextState: 'redacted',
    contextRevision: input.contextRevision,
    contextChangeSequence: input.contextChangeSequence,
    redactedAt: input.redactedAt,
    rawMatrixEvent: {
      type: 'm.room.message',
      event_id: input.target.matrixEventId,
      redacted: true,
    },
  };
}

function createRedactedReactionMessage(input: {
  target: PrivateWhatsAppMessage;
  redactedAt: string;
}): PrivateWhatsAppMessage {
  const {
    text: _text,
    media: _media,
    transcription: _transcription,
    reaction: _reaction,
    reactions: _reactions,
    rawMatrixEvent: _rawMatrixEvent,
    ...retained
  } = input.target;
  return {
    ...retained,
    contextState: 'redacted',
    redactedAt: input.redactedAt,
    ...(input.target.reaction?.targetMessageId !== undefined
      ? { redactedReactionTargetMessageId: input.target.reaction.targetMessageId }
      : {}),
    rawMatrixEvent: {
      type: 'm.reaction',
      event_id: input.target.matrixEventId,
      redacted: true,
    },
  };
}

function createRedactedOperationalMessage(input: {
  target: PrivateWhatsAppMessage;
  redactedAt: string;
}): PrivateWhatsAppMessage {
  const {
    text: _text,
    media: _media,
    transcription: _transcription,
    reaction: _reaction,
    reactions: _reactions,
    rawMatrixEvent: _rawMatrixEvent,
    ...retained
  } = input.target;
  return {
    ...retained,
    contextState: 'redacted',
    redactedAt: input.redactedAt,
    rawMatrixEvent: {
      type: input.target.relation?.kind === 'replacement' ? 'm.room.message' : 'm.room.redaction',
      event_id: input.target.matrixEventId,
      redacted: true,
    },
  };
}

function areJsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isLaterContextOperation(input: {
  candidateTimestamp: string;
  candidateId: string;
  currentTimestamp: string | undefined;
  currentId: string | undefined;
}): boolean {
  if (input.currentTimestamp === undefined) return true;
  const timestampComparison = input.candidateTimestamp.localeCompare(input.currentTimestamp);
  if (timestampComparison !== 0) return timestampComparison > 0;
  return input.currentId === undefined || input.candidateId.localeCompare(input.currentId) > 0;
}

function sanitizeReactionSummaries(
  reactions: PrivateWhatsAppMessage['reactions']
): NonNullable<PrivateWhatsAppMessage['reactions']> {
  if (reactions === undefined) return [];
  return reactions
    .map((reaction) => {
      const sanitized: NonNullable<PrivateWhatsAppMessage['reactions']>[number] = {
        id: reaction.id,
        emoji: reaction.emoji,
        direction: reaction.direction,
        eventTimestamp: reaction.eventTimestamp,
      };
      if (reaction.senderDisplayName !== undefined) {
        sanitized.senderDisplayName = reaction.senderDisplayName;
      }
      return sanitized;
    })
    .sort(compareReactionSummaries);
}
