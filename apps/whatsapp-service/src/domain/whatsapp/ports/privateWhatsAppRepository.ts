import type { Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';
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
  PrivateWhatsAppSenderQueryInput,
  PrivateWhatsAppSenderQueryResult,
  PrivateWhatsAppSenderDayQueryInput,
  PrivateWhatsAppSenderDayQueryResult,
  StorePrivateWhatsAppMessageInput,
  UpdatePrivateWhatsAppChatTranscriptionInput,
  UpdatePrivateWhatsAppMessageTranscriptionInput,
  UpsertPrivateWhatsAppAccountInput,
} from '../models/PrivateWhatsApp.js';

export interface PrivateWhatsAppRepository {
  getAccountByUserId(
    userId: string
  ): Promise<Result<PrivateWhatsAppAccount | null, WhatsAppError>>;
  getActiveAccountBySourceAccountId(
    sourceAccountId: string
  ): Promise<Result<PrivateWhatsAppAccount | null, WhatsAppError>>;
  upsertAccount(
    input: UpsertPrivateWhatsAppAccountInput
  ): Promise<Result<PrivateWhatsAppAccount, WhatsAppError>>;
  disableAccount(
    input: DisablePrivateWhatsAppAccountInput
  ): Promise<Result<PrivateWhatsAppAccount, WhatsAppError>>;
  storeIncomingMessage(
    input: StorePrivateWhatsAppMessageInput
  ): Promise<Result<PrivateWhatsAppIngestOutcome, WhatsAppError>>;
  getMessageById(
    messageId: string
  ): Promise<Result<PrivateWhatsAppMessage | null, WhatsAppError>>;
  getChatById(input: {
    sourceAccountId: string;
    chatId: string;
  }): Promise<Result<PrivateWhatsAppChat | null, WhatsAppError>>;
  updateChatTranscriptionSetting(
    input: UpdatePrivateWhatsAppChatTranscriptionInput
  ): Promise<Result<PrivateWhatsAppChat, WhatsAppError>>;
  updateMessageTranscription(
    input: UpdatePrivateWhatsAppMessageTranscriptionInput
  ): Promise<Result<void, WhatsAppError>>;
  findMessages(
    input: PrivateWhatsAppMessageQueryInput
  ): Promise<Result<PrivateWhatsAppMessageQueryResult, WhatsAppError>>;
  findConversationContextMessages(input: {
    sourceAccountId: string;
    chatId: string;
    from: string;
    to: string;
    limit: number;
  }): Promise<Result<PrivateWhatsAppConversationContextMessageResult, WhatsAppError>>;
  findChats(
    input: PrivateWhatsAppChatQueryInput
  ): Promise<Result<PrivateWhatsAppChatQueryResult, WhatsAppError>>;
  findSenders(
    input: PrivateWhatsAppSenderQueryInput
  ): Promise<Result<PrivateWhatsAppSenderQueryResult, WhatsAppError>>;
  findSenderDays(
    input: PrivateWhatsAppSenderDayQueryInput
  ): Promise<Result<PrivateWhatsAppSenderDayQueryResult, WhatsAppError>>;
  rebuildAggregates(
    input: PrivateWhatsAppAggregateRebuildInput
  ): Promise<Result<PrivateWhatsAppAggregateRebuildResult, WhatsAppError>>;
}
