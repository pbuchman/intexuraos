/**
 * Notification sender port for research alerts.
 * Implemented by WhatsApp adapter.
 */

import type { Result } from '@intexuraos/common-core';
import type { LlmProvider } from '../models/Research.js';

export interface NotificationError {
  code: 'SEND_FAILED' | 'USER_NOT_CONNECTED';
  message: string;
}

export interface NotificationSender {
  sendResearchComplete(
    userId: string,
    researchId: string,
    title: string,
    shareUrl: string
  ): Promise<Result<void, NotificationError>>;

  sendLlmFailure(
    userId: string,
    researchId: string,
    provider: LlmProvider,
    error: string
  ): Promise<Result<void, NotificationError>>;
}
