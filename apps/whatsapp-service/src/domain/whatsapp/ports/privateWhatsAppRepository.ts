import type { Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';
import type {
  DisablePrivateWhatsAppAccountInput,
  PrivateWhatsAppAccount,
  PrivateWhatsAppAggregateRebuildInput,
  PrivateWhatsAppAggregateRebuildResult,
  PrivateWhatsAppIngestOutcome,
  PrivateWhatsAppMessageQueryInput,
  PrivateWhatsAppMessageQueryResult,
  PrivateWhatsAppSenderQueryInput,
  PrivateWhatsAppSenderQueryResult,
  PrivateWhatsAppSenderDayQueryInput,
  PrivateWhatsAppSenderDayQueryResult,
  StorePrivateWhatsAppMessageInput,
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
  findMessages(
    input: PrivateWhatsAppMessageQueryInput
  ): Promise<Result<PrivateWhatsAppMessageQueryResult, WhatsAppError>>;
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
