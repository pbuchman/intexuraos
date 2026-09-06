import { err, ok, type Result } from '@intexuraos/common-core';
import type { WhatsAppError } from '../whatsapp/models/error.js';
import type { ConversationAssistantResult } from './types.js';

export function adaptConversationAssistantPreparationPublication(
  result: Result<void, WhatsAppError>
): ConversationAssistantResult<void> {
  return result.ok
    ? ok(undefined)
    : err({ code: 'INTERNAL_ERROR', message: result.error.message });
}
