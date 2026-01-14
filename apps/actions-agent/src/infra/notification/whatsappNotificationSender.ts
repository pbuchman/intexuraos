import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { NotificationSender } from '../../domain/ports/notificationSender.js';

export interface WhatsappNotificationSenderConfig {
  userServiceUrl: string;
  internalAuthToken: string;
  logger: Logger;
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
      const { logger } = config;

      logger.info({ userId, researchId, title }, 'Sending draft ready notification');

      try {
        const response = await fetch(`${config.userServiceUrl}/internal/users/${userId}/notify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({
            type: 'research_ready',
            message: `Your research "${title}" is ready! View it here: ${draftUrl}`,
            metadata: {
              researchId,
              title,
              draftUrl,
            },
          }),
        });

        if (!response.ok) {
          logger.error(
            { userId, researchId, status: response.status, statusText: response.statusText },
            'Failed to send notification'
          );
          return err(new Error(`HTTP ${String(response.status)}: Failed to send notification`));
        }

        logger.info({ userId, researchId }, 'Draft ready notification sent successfully');
        return ok(undefined);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        logger.error({ userId, researchId, error: errorMessage }, 'Network error sending notification');
        return err(new Error(`Network error: ${errorMessage}`));
      }
    },
  };
}
