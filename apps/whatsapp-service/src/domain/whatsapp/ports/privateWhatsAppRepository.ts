import type { Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../models/error.js';
import type {
  PrivateWhatsAppIngestOutcome,
  StorePrivateWhatsAppMessageInput,
} from '../models/PrivateWhatsApp.js';

export interface PrivateWhatsAppRepository {
  storeIncomingMessage(
    input: StorePrivateWhatsAppMessageInput
  ): Promise<Result<PrivateWhatsAppIngestOutcome, WhatsAppError>>;
}
