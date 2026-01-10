/**
 * HTTP client for mobile-notifications-service internal API.
 * Used for querying notifications in composite feeds.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type {
  MobileNotificationsClient,
  MobileNotificationItem,
  NotificationFilterConfig,
} from '../../domain/compositeFeed/index.js';

interface BasicLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

/**
 * Configuration for the mobile notifications client.
 */
export interface MobileNotificationsClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger?: BasicLogger;
}

/**
 * Create a mobile notifications client with the given configuration.
 */
export function createMobileNotificationsClient(
  config: MobileNotificationsClientConfig
): MobileNotificationsClient {
  const { logger } = config;

  return {
    async queryNotifications(
      userId: string,
      filter: NotificationFilterConfig
    ): Promise<Result<MobileNotificationItem[], string>> {
      try {
        const body: {
          userId: string;
          filter?: {
            app?: string[];
            source?: string;
            title?: string;
          };
          limit?: number;
        } = {
          userId,
          limit: 1000,
        };

        if (filter.app !== undefined || filter.source !== undefined || filter.title !== undefined) {
          body.filter = {};
          if (filter.app !== undefined && filter.app.length > 0) {
            body.filter.app = filter.app;
          }
          if (filter.source !== undefined && filter.source.length > 0) {
            body.filter.source = filter.source;
          }
          if (filter.title !== undefined && filter.title.length > 0) {
            body.filter.title = filter.title;
          }
        }

        const url = `${config.baseUrl}/internal/mobile-notifications/query`;
        logger?.info(
          { url, userId, filter: body.filter, limit: body.limit },
          'Querying mobile-notifications-service'
        );

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unable to read response body');
          logger?.error(
            { url, status: response.status, statusText: response.statusText, errorText },
            'Mobile-notifications-service returned error status'
          );
          return err(`HTTP ${String(response.status)}: Failed to query notifications`);
        }

        const data = (await response.json()) as {
          success: boolean;
          data?: {
            notifications: MobileNotificationItem[];
          };
          error?: string;
        };

        if (!data.success || data.data === undefined) {
          logger?.error(
            { url, error: data.error, success: data.success },
            'Mobile-notifications-service returned error response'
          );
          return err(data.error ?? 'Unknown error from mobile-notifications-service');
        }

        logger?.info(
          { url, notificationCount: data.data.notifications.length },
          'Successfully queried mobile-notifications-service'
        );
        return ok(data.data.notifications);
      } catch (error) {
        const errorMessage = getErrorMessage(error, 'Failed to connect to mobile-notifications-service');
        logger?.error(
          { baseUrl: config.baseUrl, error: errorMessage },
          'Failed to connect to mobile-notifications-service'
        );
        return err(errorMessage);
      }
    },
  };
}
