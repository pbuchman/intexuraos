/**
 * Mappers for converting between Linear domain models.
 */

import type { LinearIssue, SyncedLinearIssue } from './models.js';

/**
 * Convert SyncedLinearIssue to LinearIssue for API response.
 */
export function syncedToLinearIssue(synced: SyncedLinearIssue): LinearIssue {
  return {
    id: synced.id,
    identifier: synced.identifier,
    title: synced.title,
    description: synced.description,
    priority: synced.priority,
    state: {
      id: '', // Not stored in SyncedLinearIssue, not critical for frontend
      name: synced.state,
      type: synced.stateType,
    },
    /* v8 ignore start -- ts-type: nullish coalescing fallback for assigneeName; always provided when assigneeId is non-null @preserve */
    assignee:
      synced.assigneeId !== null
        ? { id: synced.assigneeId, name: synced.assigneeName ?? '' }
        : null,
    /* v8 ignore stop @preserve */
    url: synced.url,
    createdAt: synced.createdAt,
    updatedAt: synced.updatedAt,
    completedAt: null, // Derived from state, not stored separately
    parentId: synced.parentId,
    childCount: 0, // Will be calculated from children array
    children: [],
    labels: synced.labels,
  };
}
