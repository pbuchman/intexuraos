import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { NotificationSender } from '../../domain/ports/notificationSender.js';

export interface WhatsappNotificationSenderConfig {
  userServiceUrl: string;
  internalAuthToken: string;
}

export function createWhatsappNotificationSender(
  config: WhatsappNotificationSenderConfig
): NotificationSender {
  return {
    async sendDraftReady(
      userId: string,
      researchId: string,
      title: string,
      draftUrl: string
    ): Promise<Result<void>> {
      try {
        const message = `Your research "${title}" is ready! View it here: ${draftUrl}`;

        const response = await fetch(`${config.userServiceUrl}/internal/users/${userId}/notify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({
            type: 'research_ready',
            message,
            metadata: {
              researchId,
              title,
              draftUrl,
            },
          }),
        });

        if (!response.ok) {
          return err(new Error(`HTTP ${String(response.status)}: Failed to send notification`));
        }

        return ok(undefined);
      } catch (error) {
        return err(new Error(`Network error: ${getErrorMessage(error)}`));
      }
    },
  };
}
