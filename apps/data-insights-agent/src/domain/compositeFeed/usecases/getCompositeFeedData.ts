/**
 * Get composite feed data use case.
 * Aggregates static sources and notification data.
 */
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type {
  CompositeFeedRepository,
  MobileNotificationsClient,
  CompositeFeedData,
} from '../index.js';
import type { DataSourceRepository } from '../../dataSource/index.js';

interface BasicLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface GetCompositeFeedDataDeps {
  compositeFeedRepository: CompositeFeedRepository;
  dataSourceRepository: DataSourceRepository;
  mobileNotificationsClient: MobileNotificationsClient;
  logger: BasicLogger;
}

export interface GetCompositeFeedDataError {
  code: 'NOT_FOUND' | 'REPOSITORY_ERROR' | 'NOTIFICATIONS_ERROR';
  message: string;
}

export async function getCompositeFeedData(
  feedId: string,
  userId: string,
  deps: GetCompositeFeedDataDeps
): Promise<Result<CompositeFeedData, GetCompositeFeedDataError>> {
  const { compositeFeedRepository, dataSourceRepository, mobileNotificationsClient, logger } = deps;

  logger.info({ feedId, userId }, 'Getting composite feed data');

  const feedResult = await compositeFeedRepository.getById(feedId, userId);
  if (!feedResult.ok) {
    logger.error({ feedId, userId, error: feedResult.error }, 'Failed to fetch feed from repository');
    return err({
      code: 'REPOSITORY_ERROR',
      message: feedResult.error,
    });
  }

  if (feedResult.value === null) {
    logger.warn({ feedId, userId }, 'Composite feed not found');
    return err({
      code: 'NOT_FOUND',
      message: 'Composite feed not found',
    });
  }

  const feed = feedResult.value;
  logger.info(
    {
      feedId,
      feedName: feed.name,
      staticSourceCount: feed.staticSourceIds.length,
      notificationFilterCount: feed.notificationFilters.length,
    },
    'Fetched composite feed configuration'
  );

  const staticSources: { id: string; name: string; content: string }[] = [];
  for (const sourceId of feed.staticSourceIds) {
    const sourceResult = await dataSourceRepository.getById(sourceId, userId);
    if (!sourceResult.ok) {
      logger.warn({ feedId, sourceId, error: sourceResult.error }, 'Failed to fetch static source');
      continue;
    }
    if (sourceResult.value !== null) {
      staticSources.push({
        id: sourceResult.value.id,
        name: sourceResult.value.title,
        content: sourceResult.value.content,
      });
    } else {
      logger.warn({ feedId, sourceId }, 'Static source not found');
    }
  }
  logger.info({ feedId, staticSourcesFetched: staticSources.length }, 'Fetched static sources');

  const notifications: {
    filterId: string;
    filterName: string;
    criteria: {
      app?: string[];
      source?: string;
      title?: string;
    };
    items: {
      id: string;
      app: string;
      title: string;
      body: string;
      timestamp: string;
      source?: string;
    }[];
  }[] = [];

  for (const filter of feed.notificationFilters) {
    logger.info(
      { feedId, filterId: filter.id, filterName: filter.name, criteria: { app: filter.app, source: filter.source, title: filter.title } },
      'Querying notifications for filter'
    );

    const notificationsResult = await mobileNotificationsClient.queryNotifications(userId, filter);

    const criteria: { app?: string[]; source?: string; title?: string } = {};
    if (filter.app !== undefined && filter.app.length > 0) {
      criteria.app = filter.app;
    }
    if (filter.source !== undefined && filter.source.length > 0) {
      criteria.source = filter.source;
    }
    if (filter.title !== undefined && filter.title.length > 0) {
      criteria.title = filter.title;
    }

    if (!notificationsResult.ok) {
      logger.error(
        { feedId, filterId: filter.id, filterName: filter.name, error: notificationsResult.error },
        'Failed to query notifications from mobile-notifications-service'
      );
      notifications.push({
        filterId: filter.id,
        filterName: filter.name,
        criteria,
        items: [],
      });
      continue;
    }

    logger.info(
      { feedId, filterId: filter.id, filterName: filter.name, notificationCount: notificationsResult.value.length },
      'Fetched notifications for filter'
    );
    notifications.push({
      filterId: filter.id,
      filterName: filter.name,
      criteria,
      items: notificationsResult.value,
    });
  }

  const totalNotifications = notifications.reduce((sum, n) => sum + n.items.length, 0);
  logger.info(
    { feedId, staticSourceCount: staticSources.length, filterCount: notifications.length, totalNotifications },
    'Composite feed data aggregation complete'
  );

  const data: CompositeFeedData = {
    feedId: feed.id,
    feedName: feed.name,
    purpose: feed.purpose,
    generatedAt: new Date().toISOString(),
    staticSources,
    notifications,
  };

  return ok(data);
}
