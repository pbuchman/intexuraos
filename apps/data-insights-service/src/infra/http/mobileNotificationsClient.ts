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

/**
 * Configuration for the mobile notifications client.
 */
export interface MobileNotificationsClientConfig {
  baseUrl: string;
  internalAuthToken: string;
}

/**
 * Create a mobile notifications client with the given configuration.
 */
export function createMobileNotificationsClient(
  config: MobileNotificationsClientConfig
): MobileNotificationsClient {
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
          limit: 100,
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

        const response = await fetch(`${config.baseUrl}/internal/mobile-notifications/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
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
          return err(data.error ?? 'Unknown error from mobile-notifications-service');
        }

        return ok(data.data.notifications);
      } catch (error) {
        return err(getErrorMessage(error, 'Failed to connect to mobile-notifications-service'));
      }
    },
  };
}
