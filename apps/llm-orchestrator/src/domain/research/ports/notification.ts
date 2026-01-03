/**
 * Notification sender port for research alerts.
 * Implemented by WhatsApp adapter.
 */

import type { Result } from '@intexuraos/common-core';

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
    model: string,
    error: string
  ): Promise<Result<void, NotificationError>>;
}
