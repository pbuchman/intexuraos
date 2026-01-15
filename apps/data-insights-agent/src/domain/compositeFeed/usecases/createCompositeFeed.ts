/**
 * Create composite feed use case.
 */
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type {
  CompositeFeed,
  CreateCompositeFeedRequest,
  CompositeFeedRepository,
  FeedNameGenerationService,
} from '../index.js';
import type { DataSourceRepository } from '../../dataSource/index.js';
import { MAX_STATIC_SOURCES, MAX_NOTIFICATION_FILTERS } from '../models/index.js';

interface BasicLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface CreateCompositeFeedDeps {
  compositeFeedRepository: CompositeFeedRepository;
  dataSourceRepository: DataSourceRepository;
  feedNameGenerationService: FeedNameGenerationService;
  logger: BasicLogger;
}

export interface CreateCompositeFeedError {
  code: 'VALIDATION_ERROR' | 'NAME_GENERATION_ERROR' | 'REPOSITORY_ERROR' | 'SOURCE_NOT_FOUND';
  message: string;
}

export async function createCompositeFeed(
  userId: string,
  request: CreateCompositeFeedRequest,
  deps: CreateCompositeFeedDeps
): Promise<Result<CompositeFeed, CreateCompositeFeedError>> {
  const { compositeFeedRepository, dataSourceRepository, feedNameGenerationService, logger } = deps;

  logger.info(
    {
      userId,
      staticSourceCount: request.staticSourceIds.length,
      filterCount: request.notificationFilters.length,
    },
    'Creating composite feed'
  );

  if (request.staticSourceIds.length > MAX_STATIC_SOURCES) {
    logger.warn(
      {
        userId,
        requestedSourceCount: request.staticSourceIds.length,
        maxSources: MAX_STATIC_SOURCES,
      },
      'Validation failed: too many static sources'
    );
    return err({
      code: 'VALIDATION_ERROR',
      message: `Maximum ${String(MAX_STATIC_SOURCES)} static sources allowed`,
    });
  }

  if (request.notificationFilters.length > MAX_NOTIFICATION_FILTERS) {
    logger.warn(
      {
        userId,
        requestedFilterCount: request.notificationFilters.length,
        maxFilters: MAX_NOTIFICATION_FILTERS,
      },
      'Validation failed: too many notification filters'
    );
    return err({
      code: 'VALIDATION_ERROR',
      message: `Maximum ${String(MAX_NOTIFICATION_FILTERS)} notification filters allowed`,
    });
  }

  if (request.purpose.trim().length === 0) {
    logger.warn({ userId }, 'Validation failed: empty purpose');
    return err({
      code: 'VALIDATION_ERROR',
      message: 'Purpose is required',
    });
  }

  const sourceNames: string[] = [];
  for (const sourceId of request.staticSourceIds) {
    const sourceResult = await dataSourceRepository.getById(sourceId, userId);
    if (!sourceResult.ok) {
      logger.error({ userId, sourceId, error: sourceResult.error }, 'Failed to fetch data source');
      return err({
        code: 'REPOSITORY_ERROR',
        message: sourceResult.error,
      });
    }
    if (sourceResult.value === null) {
      logger.warn({ userId, sourceId }, 'Data source not found');
      return err({
        code: 'SOURCE_NOT_FOUND',
        message: `Data source not found: ${sourceId}`,
      });
    }
    sourceNames.push(sourceResult.value.title);
  }

  const filterNames = request.notificationFilters.map((f) => f.name);

  const nameResult = await feedNameGenerationService.generateName(
    userId,
    request.purpose,
    sourceNames,
    filterNames
  );

  if (!nameResult.ok) {
    logger.error({ userId, error: nameResult.error.message }, 'Feed name generation failed');
    return err({
      code: 'NAME_GENERATION_ERROR',
      message: nameResult.error.message,
    });
  }

  const feedResult = await compositeFeedRepository.create(userId, nameResult.value, request);

  if (!feedResult.ok) {
    logger.error({ userId, error: feedResult.error }, 'Failed to create composite feed in repository');
    return err({
      code: 'REPOSITORY_ERROR',
      message: feedResult.error,
    });
  }

  logger.info({ userId, feedId: feedResult.value.id, feedName: feedResult.value.name }, 'Composite feed created successfully');

  return ok(feedResult.value);
}
