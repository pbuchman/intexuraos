/**
 * Visualization domain ports.
 */
import type { Result } from '@intexuraos/common-core';
import type { Visualization, VisualizationStatus } from '../models/index.js';

export interface VisualizationUpdateFields {
  chartData?: unknown[] | null;
  status?: VisualizationStatus;
  lastError?: string | null;
  lastRefreshedAt?: Date;
}

export interface VisualizationRepository {
  create(
    viz: Omit<Visualization, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Result<Visualization, string>>;

  getById(id: string, userId: string): Promise<Result<Visualization | null, string>>;

  getByIdInternal(id: string): Promise<Result<Visualization | null, string>>;

  listByUserId(userId: string): Promise<Result<Visualization[], string>>;

  listByFeedId(feedId: string): Promise<Result<Visualization[], string>>;

  update(id: string, fields: VisualizationUpdateFields): Promise<Result<Visualization, string>>;

  delete(id: string, userId: string): Promise<Result<void, string>>;

  deleteByFeedId(feedId: string): Promise<Result<void, string>>;
}
