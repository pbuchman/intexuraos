import { createHash } from 'node:crypto';
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
  UpsertPrivateWhatsAppAccountInput,
} from '../../domain/whatsapp/index.js';
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
const PRIVATE_WHATSAPP_ACCOUNT_SCHEMA_VERSION = 1;
const PRIVATE_WHATSAPP_SCHEMA_VERSION = 2;
const PRIVATE_WHATSAPP_EVENT_TIME_ZONE = 'Europe/Warsaw';
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
type FirestoreClient = ReturnType<typeof getFirestore>;
type FirestoreTransaction = Parameters<Parameters<FirestoreClient['runTransaction']>[0]>[0];

interface PrivateChatResolution {
  chatId: string;
}

export {
  createPrivateWhatsAppChatId,
  createPrivateWhatsAppMessageId,
  createPrivateWhatsAppSenderDayId,
  createPrivateWhatsAppSenderId,
} from '../../domain/whatsapp/utils/privateWhatsAppIds.js';

function createPrivateWhatsAppSourceAccountId(userId: string): string {
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
    const account = await db.runTransaction(async (transaction) => {
      const existingDoc = await transaction.get(accountRef);
      const existingAccount = existingDoc.exists
        ? toPrivateWhatsAppAccount(existingDoc.id, existingDoc.data())
        : undefined;
      const nextAccount = buildPrivateWhatsAppAccount(input, existingAccount);
      transaction.set(accountRef, nextAccount);
      return nextAccount;
    });
    return ok(account);
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
  const projected: PrivateWhatsAppAccount = {
    id,
    userId: typeof account?.userId === 'string' ? account.userId : id,
    sourceAccountId:
      typeof account?.sourceAccountId === 'string'
        ? account.sourceAccountId
        : createPrivateWhatsAppSourceAccountId(id),
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
  if (typeof account?.messageCount === 'number') {
    projected.messageCount = account.messageCount;
  }
  if (typeof account?.senderCount === 'number') {
    projected.senderCount = account.senderCount;
  }
  return projected;
}

function buildPrivateWhatsAppAccount(
  input: UpsertPrivateWhatsAppAccountInput,
  existingAccount: PrivateWhatsAppAccount | undefined
): PrivateWhatsAppAccount {
  const account: PrivateWhatsAppAccount = {
    id: input.userId,
    userId: input.userId,
    sourceAccountId:
      existingAccount?.sourceAccountId ?? createPrivateWhatsAppSourceAccountId(input.userId),
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
      const existingMessage = await transaction.get(messageRef);
      if (existingMessage.exists) {
        const existingData = existingMessage.data() as Partial<PrivateWhatsAppMessage> | undefined;
        const existingChatId =
          typeof existingData?.chatId === 'string'
            ? existingData.chatId
            : createPrivateWhatsAppChatId(input.sourceAccountId, input.chat.matrixRoomId);
        return {
          outcome: 'duplicate' as const,
          chatId: existingChatId,
          messageId,
          matrixEventId: input.message.matrixEventId,
        };
      }

      const chatResolution = await resolveChatForStore(db, transaction, input, senderKey);
      const chatId = chatResolution.chatId;
      const chatRef = db.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(chatId);
      const existingChat = await transaction.get(chatRef);
      const existingSender = await transaction.get(senderRef);
      const existingSenderDay = await transaction.get(senderDayRef);
      const existingAccount = await transaction.get(accountRef);
      const chat = buildChat(input, chatId, existingChat.data() as PrivateWhatsAppChat | undefined);
      const message = buildMessage(input, chatId, messageId);
      const sender = buildSender(
        input,
        senderId,
        chatId,
        existingSender.data() as PrivateWhatsAppSender | undefined
      );
      const senderDay = buildSenderDay(
        input,
        senderDayId,
        chatId,
        existingSenderDay.data() as PrivateWhatsAppSenderDay | undefined
      );

      transaction.set(chatRef, chat, { merge: true });
      transaction.set(messageRef, message);
      transaction.set(senderRef, sender);
      transaction.set(senderDayRef, senderDay);
      if (existingAccount.exists) {
        transaction.set(
          accountRef,
          buildAccountIngestFields(
            input,
            existingAccount.data() as PrivateWhatsAppAccount,
            existingSender.exists
          ),
          { merge: true }
        );
      }

      return {
        outcome: 'created' as const,
        chatId,
        messageId,
        matrixEventId: input.message.matrixEventId,
        ...(chat.transcriptionEnabled === true ? { chatTranscriptionEnabled: true } : {}),
      };
    });

    return ok(outcome);
  } catch (error) {
    return err({
      code: 'PERSISTENCE_ERROR',
      message: `Failed to store private WhatsApp message: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
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
    const data = doc.data() as Omit<PrivateWhatsAppMessage, 'id'> & { id?: string };
    return ok({ ...data, id: data.id ?? doc.id });
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
      ): Promise<{ status: 'not_found' } | { status: 'ok'; chat: PrivateWhatsAppChat }> => {
        const chatDoc = await transaction.get(chatRef);
        if (!chatDoc.exists) {
          return { status: 'not_found' };
        }

        const existingChat = normalizeChat(chatDoc.id, chatDoc.data());
        if (existingChat.sourceAccountId !== input.sourceAccountId) {
          return { status: 'not_found' };
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
): Promise<Result<void, WhatsAppError>> {
  try {
    const db = getFirestore();
    const messageRef = db.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(input.messageId);
    const outcome = await db.runTransaction(async (transaction): Promise<'not_found' | 'ok'> => {
      const messageDoc = await transaction.get(messageRef);
      if (!messageDoc.exists) {
        return 'not_found';
      }

      const rawMessage = messageDoc.data() as Omit<PrivateWhatsAppMessage, 'id'> & { id?: string };
      const message: PrivateWhatsAppMessage = { ...rawMessage, id: rawMessage.id ?? messageDoc.id };
      if (message.userId !== input.userId) {
        return 'not_found';
      }

      transaction.update(messageRef, {
        transcription: input.transcription,
        schemaVersion: PRIVATE_WHATSAPP_SCHEMA_VERSION,
      });
      return 'ok';
    });

    if (outcome === 'not_found') {
      return err({ code: 'NOT_FOUND', message: 'Private WhatsApp message not found' });
    }
    return ok(undefined);
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
    const messages = docs.map((doc) => {
      const data = doc.data() as Omit<PrivateWhatsAppMessage, 'id'> & { id?: string };
      return { ...data, id: data.id ?? doc.id };
    });
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
    const targetMessageIdSet = new Set(targetMessageIds);
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
    const messages = docs.map((doc) => {
      const data = doc.data() as Omit<PrivateWhatsAppMessage, 'id'> & { id?: string };
      return { ...data, id: data.id ?? doc.id };
    });
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
    let messageQuery: Query = db
      .collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION)
      .where('sourceAccountId', '==', input.sourceAccountId);
    if (input.from !== undefined) {
      messageQuery = messageQuery.where('eventTimestamp', '>=', input.from);
    }
    if (input.to !== undefined) {
      messageQuery = messageQuery.where('eventTimestamp', '<', input.to);
    }

    const messageSnapshot = await messageQuery
      .orderBy('eventTimestamp', 'asc')
      .limit(input.limit)
      .get();
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

      senders.set(senderId, buildSender(storeInput, senderId, chatId, senders.get(senderId)));
      senderDays.set(
        senderDayId,
        buildSenderDay(storeInput, senderDayId, chatId, senderDays.get(senderDayId))
      );

      const upgradeFields = buildMessageUpgradeFields(message, storeInput);
      if (upgradeFields !== undefined) {
        messageUpgrades.push({ messageId: doc.id, fields: upgradeFields });
      }
    }

    const existingSenders = await db
      .collection(PRIVATE_WHATSAPP_SENDERS_COLLECTION)
      .where('sourceAccountId', '==', input.sourceAccountId)
      .get();
    const existingSenderDays = await db
      .collection(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION)
      .where('sourceAccountId', '==', input.sourceAccountId)
      .get();

    const batch = db.batch();
    for (const doc of existingSenders.docs) {
      batch.delete(doc.ref);
    }
    for (const doc of existingSenderDays.docs) {
      batch.delete(doc.ref);
    }
    for (const upgrade of messageUpgrades) {
      batch.set(
        db.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(upgrade.messageId),
        upgrade.fields,
        { merge: true }
      );
    }
    for (const [senderId, sender] of senders.entries()) {
      batch.set(db.collection(PRIVATE_WHATSAPP_SENDERS_COLLECTION).doc(senderId), sender);
    }
    for (const [senderDayId, senderDay] of senderDays.entries()) {
      batch.set(
        db.collection(PRIVATE_WHATSAPP_SENDER_DAYS_COLLECTION).doc(senderDayId),
        senderDay
      );
    }
    await batch.commit();

    return ok({
      scannedMessages: messageSnapshot.docs.length,
      upgradedMessages: messageUpgrades.length,
      senderCount: senders.size,
      senderDayCount: senderDays.size,
    });
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

function buildSender(
  input: StorePrivateWhatsAppMessageInput,
  senderId: string,
  chatId: string,
  existingSender: PrivateWhatsAppSender | undefined
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

  const senderDisplayName = selectLatestString(
    existingSender?.senderDisplayName,
    input.message.senderDisplayName,
    existingSender?.lastEventAt,
    input.message.eventTimestamp
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
  existingSenderDay: PrivateWhatsAppSenderDay | undefined
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

  const senderDisplayName = selectLatestString(
    existingSenderDay?.senderDisplayName,
    input.message.senderDisplayName,
    existingSenderDay?.lastEventAt,
    input.message.eventTimestamp
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
  const data = doc.data() as Omit<PrivateWhatsAppMessage, 'id'> & { id?: string };
  return { ...data, id: data.id ?? doc.id };
}

function firstNonEmptyString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value.trim() === '' ? undefined : value;
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
  messageId: string
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

  if (input.message.senderDisplayName !== undefined) {
    message.senderDisplayName = input.message.senderDisplayName;
  }
  if (input.message.senderPhoneNumber !== undefined) {
    message.senderPhoneNumber = input.message.senderPhoneNumber;
  }
  const senderPhoneNumberNormalized = getSenderPhoneNumberNormalized(input);
  if (senderPhoneNumberNormalized !== undefined) {
    message.senderPhoneNumberNormalized = senderPhoneNumberNormalized;
  }
  if (input.chat.displayName !== undefined) {
    message.chatDisplayName = input.chat.displayName;
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
    };
  }

  return message;
}
