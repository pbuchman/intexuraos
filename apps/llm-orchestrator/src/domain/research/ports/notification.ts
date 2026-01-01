/**
 * Notification sender port for research completion alerts.
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
    title: string
  ): Promise<Result<void, NotificationError>>;
}
