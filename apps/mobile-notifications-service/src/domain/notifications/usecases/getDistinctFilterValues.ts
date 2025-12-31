/**
 * Use case for getting distinct filter values.
 * Used to populate filter dropdowns.
 */
import { err, ok, type Result } from '@intexuraos/common-core';
import type { DistinctFilterField, NotificationRepository, RepositoryError, } from '../ports/index.js';

/**
 * Input for getting distinct filter values.
 */
export interface GetDistinctFilterValuesInput {
  userId: string;
  field: DistinctFilterField;
}

/**
 * Get distinct values for a filterable field.
 */
export async function getDistinctFilterValues(
  input: GetDistinctFilterValuesInput,
  repo: NotificationRepository
): Promise<Result<string[], RepositoryError>> {
  const result = await repo.getDistinctValues(input.userId, input.field);

  if (!result.ok) {
    return err(result.error);
  }

  return ok(result.value);
}
