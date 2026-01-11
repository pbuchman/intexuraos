/**
 * Data source repository port.
 */
import type { Result } from '@intexuraos/common-core';
import type {
  DataSource,
  CreateDataSourceRequest,
  UpdateDataSourceRequest,
} from '../models/index.js';

/**
 * Repository interface for data source persistence.
 */
export interface DataSourceRepository {
  /**
   * Create a new data source for a user.
   */
  create(userId: string, request: CreateDataSourceRequest): Promise<Result<DataSource, string>>;

  /**
   * Get a data source by ID for a specific user.
   * Returns null if not found or not owned by user.
   */
  getById(id: string, userId: string): Promise<Result<DataSource | null, string>>;

  /**
   * List all data sources for a user.
   */
  listByUserId(userId: string): Promise<Result<DataSource[], string>>;

  /**
   * Update an existing data source.
   * Only updates if owned by the specified user.
   */
  update(
    id: string,
    userId: string,
    request: UpdateDataSourceRequest
  ): Promise<Result<DataSource, string>>;

  /**
   * Delete a data source.
   * Only deletes if owned by the specified user.
   */
  delete(id: string, userId: string): Promise<Result<void, string>>;
}
