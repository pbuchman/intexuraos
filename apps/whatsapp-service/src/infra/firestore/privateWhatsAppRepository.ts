import { createHash } from 'node:crypto';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { WhatsAppError } from '../../domain/whatsapp/index.js';
import type {
  PrivateWhatsAppChat,
  PrivateWhatsAppIngestOutcome,
  PrivateWhatsAppMessage,
  StorePrivateWhatsAppMessageInput,
} from '../../domain/whatsapp/index.js';
import type { PrivateWhatsAppRepository } from '../../domain/whatsapp/index.js';

export const PRIVATE_WHATSAPP_CHATS_COLLECTION = 'whatsapp_private_chats';
export const PRIVATE_WHATSAPP_MESSAGES_COLLECTION = 'whatsapp_private_messages';

export function createPrivateWhatsAppChatId(
  sourceAccountId: string,
  matrixRoomId: string
): string {
  return createPrivateWhatsAppId(sourceAccountId, matrixRoomId);
}

export function createPrivateWhatsAppMessageId(
  sourceAccountId: string,
  matrixEventId: string
): string {
  return createPrivateWhatsAppId(sourceAccountId, matrixEventId);
}

function createPrivateWhatsAppId(sourceAccountId: string, matrixId: string): string {
  return createHash('sha256').update(`${sourceAccountId}\0${matrixId}`).digest('hex');
}

export function createPrivateWhatsAppRepository(): PrivateWhatsAppRepository {
  return {
    storeIncomingMessage,
  };
}

async function storeIncomingMessage(
  input: StorePrivateWhatsAppMessageInput
): Promise<Result<PrivateWhatsAppIngestOutcome, WhatsAppError>> {
  try {
    const db = getFirestore();
    const chatId = createPrivateWhatsAppChatId(input.sourceAccountId, input.chat.matrixRoomId);
    const messageId = createPrivateWhatsAppMessageId(
      input.sourceAccountId,
      input.message.matrixEventId
    );
    const chatRef = db.collection(PRIVATE_WHATSAPP_CHATS_COLLECTION).doc(chatId);
    const messageRef = db.collection(PRIVATE_WHATSAPP_MESSAGES_COLLECTION).doc(messageId);

    const outcome = await db.runTransaction(async (transaction) => {
      const existingMessage = await transaction.get(messageRef);
      if (existingMessage.exists) {
        return {
          outcome: 'duplicate' as const,
          chatId,
          messageId,
          matrixEventId: input.message.matrixEventId,
        };
      }

      const existingChat = await transaction.get(chatRef);
      const chat = buildChat(input, chatId, existingChat.data() as PrivateWhatsAppChat | undefined);
      const message = buildMessage(input, chatId, messageId);

      transaction.set(chatRef, chat, { merge: true });
      transaction.set(messageRef, message);

      return {
        outcome: 'created' as const,
        chatId,
        messageId,
        matrixEventId: input.message.matrixEventId,
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

function buildChat(
  input: StorePrivateWhatsAppMessageInput,
  chatId: string,
  existingChat: PrivateWhatsAppChat | undefined
): PrivateWhatsAppChat {
  const now = new Date().toISOString();
  const shouldApplyIncomingChatMetadata = isSameOrNewerChatEvent(
    existingChat,
    input.message.eventTimestamp
  );
  const chat: PrivateWhatsAppChat = {
    id: chatId,
    userId: input.userId,
    sourceAccountId: input.sourceAccountId,
    matrixRoomId: input.chat.matrixRoomId,
    chatType: selectChatType(existingChat, input.chat.type, shouldApplyIncomingChatMetadata),
    firstSeenAt: oldestTimestamp(existingChat?.firstSeenAt, input.message.eventTimestamp),
    lastEventAt: newestTimestamp(existingChat?.lastEventAt, input.message.eventTimestamp),
    updatedAt: now,
  };

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
  return nextChatType;
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
    direction: input.message.direction,
    messageType: input.message.type,
    eventTimestamp: input.message.eventTimestamp,
    receivedAt: input.receivedAt,
    ingestedAt: new Date().toISOString(),
    deliveryMode: input.deliveryMode,
    rawMatrixEvent: input.message.rawMatrixEvent,
  };

  if (input.message.senderDisplayName !== undefined) {
    message.senderDisplayName = input.message.senderDisplayName;
  }
  if (input.message.senderPhoneNumber !== undefined) {
    message.senderPhoneNumber = input.message.senderPhoneNumber;
  }
  if (input.message.text !== undefined) {
    message.text = input.message.text;
  }
  if (input.message.media !== undefined) {
    message.media = input.message.media;
  }

  return message;
}
