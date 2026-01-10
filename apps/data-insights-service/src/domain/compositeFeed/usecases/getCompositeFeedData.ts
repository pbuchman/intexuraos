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

export interface GetCompositeFeedDataDeps {
  compositeFeedRepository: CompositeFeedRepository;
  dataSourceRepository: DataSourceRepository;
  mobileNotificationsClient: MobileNotificationsClient;
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
  const { compositeFeedRepository, dataSourceRepository, mobileNotificationsClient } = deps;

  const feedResult = await compositeFeedRepository.getById(feedId, userId);
  if (!feedResult.ok) {
    return err({
      code: 'REPOSITORY_ERROR',
      message: feedResult.error,
    });
  }

  if (feedResult.value === null) {
    return err({
      code: 'NOT_FOUND',
      message: 'Composite feed not found',
    });
  }

  const feed = feedResult.value;

  const staticSources: { id: string; name: string; content: string }[] = [];
  for (const sourceId of feed.staticSourceIds) {
    const sourceResult = await dataSourceRepository.getById(sourceId, userId);
    if (!sourceResult.ok) {
      continue;
    }
    if (sourceResult.value !== null) {
      staticSources.push({
        id: sourceResult.value.id,
        name: sourceResult.value.title,
        content: sourceResult.value.content,
      });
    }
  }

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
      notifications.push({
        filterId: filter.id,
        filterName: filter.name,
        criteria,
        items: [],
      });
      continue;
    }

    notifications.push({
      filterId: filter.id,
      filterName: filter.name,
      criteria,
      items: notificationsResult.value,
    });
  }

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
