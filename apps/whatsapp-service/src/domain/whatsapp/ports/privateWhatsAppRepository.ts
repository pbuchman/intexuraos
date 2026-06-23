import type { Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';
import type {
  PrivateWhatsAppAggregateRebuildInput,
  PrivateWhatsAppAggregateRebuildResult,
  PrivateWhatsAppIngestOutcome,
  PrivateWhatsAppMessageQueryInput,
  PrivateWhatsAppMessageQueryResult,
  PrivateWhatsAppSenderDayQueryInput,
  PrivateWhatsAppSenderDayQueryResult,
  StorePrivateWhatsAppMessageInput,
} from '../models/PrivateWhatsApp.js';

export interface PrivateWhatsAppRepository {
  storeIncomingMessage(
    input: StorePrivateWhatsAppMessageInput
  ): Promise<Result<PrivateWhatsAppIngestOutcome, WhatsAppError>>;
  findMessages(
    input: PrivateWhatsAppMessageQueryInput
  ): Promise<Result<PrivateWhatsAppMessageQueryResult, WhatsAppError>>;
  findSenderDays(
    input: PrivateWhatsAppSenderDayQueryInput
  ): Promise<Result<PrivateWhatsAppSenderDayQueryResult, WhatsAppError>>;
  rebuildAggregates(
    input: PrivateWhatsAppAggregateRebuildInput
  ): Promise<Result<PrivateWhatsAppAggregateRebuildResult, WhatsAppError>>;
}
