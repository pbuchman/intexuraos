import type { Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';
import type {
  PrivateWhatsAppContextJournalQueryInput,
  PrivateWhatsAppContextJournalQueryResult,
  PrivateWhatsAppContextMessagesByIdsInput,
  PrivateWhatsAppOwnedChatInput,
} from '../models/PrivateWhatsAppContextJournal.js';
import type {
  DisablePrivateWhatsAppAccountInput,
  PrivateWhatsAppAccount,
  PrivateWhatsAppAggregateRebuildInput,
  PrivateWhatsAppAggregateRebuildResult,
  PrivateWhatsAppChat,
  PrivateWhatsAppChatQueryInput,
  PrivateWhatsAppChatQueryResult,
  PrivateWhatsAppConversationContextMessageResult,
  PrivateConversationContextMessageQueryInput,
  PrivateWhatsAppIngestOutcome,
  PrivateWhatsAppMessage,
  PrivateWhatsAppMessageQueryInput,
  PrivateWhatsAppMessageQueryResult,
  PrivateWhatsAppReactionQueryInput,
  PrivateWhatsAppReactionQueryResult,
  PrivateWhatsAppSenderQueryInput,
  PrivateWhatsAppSenderQueryResult,
  PrivateWhatsAppSenderDayQueryInput,
  PrivateWhatsAppSenderDayQueryResult,
  StorePrivateWhatsAppMessageInput,
  UpdatePrivateWhatsAppChatTranscriptionInput,
  UpdatePrivateWhatsAppMessageStoredMediaInput,
  UpdatePrivateWhatsAppMessageStoredMediaResult,
  UpdatePrivateWhatsAppMessageTranscriptionInput,
  UpdatePrivateWhatsAppMessageTranscriptionResult,
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
  updateMessageStoredMedia(
    input: UpdatePrivateWhatsAppMessageStoredMediaInput
  ): Promise<Result<UpdatePrivateWhatsAppMessageStoredMediaResult, WhatsAppError>>;
  updateMessageTranscription(
    input: UpdatePrivateWhatsAppMessageTranscriptionInput
  ): Promise<Result<UpdatePrivateWhatsAppMessageTranscriptionResult, WhatsAppError>>;
  getConversationContextJournalHead(
    input: PrivateWhatsAppOwnedChatInput
  ): Promise<Result<number, WhatsAppError>>;
  findConversationContextJournalEntries(
    input: PrivateWhatsAppContextJournalQueryInput
  ): Promise<Result<PrivateWhatsAppContextJournalQueryResult, WhatsAppError>>;
  findConversationContextMessagesByIds(
    input: PrivateWhatsAppContextMessagesByIdsInput
  ): Promise<Result<PrivateWhatsAppMessage[], WhatsAppError>>;
  findMessages(
    input: PrivateWhatsAppMessageQueryInput
  ): Promise<Result<PrivateWhatsAppMessageQueryResult, WhatsAppError>>;
  findReactionsForMessageIds(
    input: PrivateWhatsAppReactionQueryInput
  ): Promise<Result<PrivateWhatsAppReactionQueryResult, WhatsAppError>>;
  findConversationContextMessages(
    input: PrivateConversationContextMessageQueryInput
  ): Promise<Result<PrivateWhatsAppConversationContextMessageResult, WhatsAppError>>;
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
