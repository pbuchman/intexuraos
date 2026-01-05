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

export interface CreateCompositeFeedDeps {
  compositeFeedRepository: CompositeFeedRepository;
  dataSourceRepository: DataSourceRepository;
  feedNameGenerationService: FeedNameGenerationService;
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
  const { compositeFeedRepository, dataSourceRepository, feedNameGenerationService } = deps;

  if (request.staticSourceIds.length > MAX_STATIC_SOURCES) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `Maximum ${String(MAX_STATIC_SOURCES)} static sources allowed`,
    });
  }

  if (request.notificationFilters.length > MAX_NOTIFICATION_FILTERS) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `Maximum ${String(MAX_NOTIFICATION_FILTERS)} notification filters allowed`,
    });
  }

  if (request.purpose.trim().length === 0) {
    return err({
      code: 'VALIDATION_ERROR',
      message: 'Purpose is required',
    });
  }

  const sourceNames: string[] = [];
  for (const sourceId of request.staticSourceIds) {
    const sourceResult = await dataSourceRepository.getById(sourceId, userId);
    if (!sourceResult.ok) {
      return err({
        code: 'REPOSITORY_ERROR',
        message: sourceResult.error,
      });
    }
    if (sourceResult.value === null) {
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
    return err({
      code: 'NAME_GENERATION_ERROR',
      message: nameResult.error.message,
    });
  }

  const feedResult = await compositeFeedRepository.create(userId, nameResult.value, request);

  if (!feedResult.ok) {
    return err({
      code: 'REPOSITORY_ERROR',
      message: feedResult.error,
    });
  }

  return ok(feedResult.value);
}
