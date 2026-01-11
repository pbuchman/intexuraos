/**
 * Repository interface for visualization persistence.
 */
import type { Result } from '@intexuraos/common-core';
import type { Visualization, VisualizationType, VisualizationStatus } from './types.js';

export interface VisualizationRepository {
  create(
    feedId: string,
    userId: string,
    data: {
      title: string;
      description: string;
      type: VisualizationType;
    }
  ): Promise<Result<Visualization, string>>;

  getById(
    id: string,
    feedId: string,
    userId: string
  ): Promise<Result<Visualization | null, string>>;

  listByFeedId(
    feedId: string,
    userId: string
  ): Promise<Result<Visualization[], string>>;

  update(
    id: string,
    feedId: string,
    userId: string,
    data: {
      title?: string;
      description?: string;
      type?: VisualizationType;
      status?: VisualizationStatus;
      htmlContent?: string | null;
      errorMessage?: string | null;
      renderErrorCount?: number;
      lastGeneratedAt?: Date;
    }
  ): Promise<Result<Visualization, string>>;

  delete(
    id: string,
    feedId: string,
    userId: string
  ): Promise<Result<void, string>>;

  incrementRenderErrorCount(
    id: string,
    feedId: string,
    userId: string
  ): Promise<Result<number, string>>;
}
