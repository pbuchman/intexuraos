/**
 * API client for the issue-groups endpoint.
 * Follows the same pattern as codeAgentApi.ts.
 */

import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { GroupStatus, ListIssueGroupsResponse, SortOption } from '@/types/issueGroups';

/**
 * List issue groups with server-side grouping, filtering, sorting, and pagination.
 */
export async function listIssueGroups(
  accessToken: string,
  options?: {
    groupStatus?: GroupStatus[];
    sortBy?: SortOption;
    limit?: number;
    cursor?: string;
  }
): Promise<ListIssueGroupsResponse> {
  const params = new URLSearchParams();
  if (options?.groupStatus !== undefined && options.groupStatus.length > 0) {
    params.set('groupStatus', options.groupStatus.join(','));
  }
  if (options?.sortBy !== undefined) {
    params.set('sortBy', options.sortBy);
  }
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options?.cursor !== undefined) {
    params.set('cursor', options.cursor);
  }
  const query = params.toString();
  const path = query !== '' ? `/issue-groups?${query}` : '/issue-groups';
  return await apiRequest<ListIssueGroupsResponse>(config.codeAgentUrl, path, accessToken);
}

/**
 * Toggle the important flag on an issue group.
 */
export async function setGroupImportant(
  accessToken: string,
  groupKey: string,
  important: boolean,
): Promise<{ important: boolean }> {
  return await apiRequest<{ important: boolean }>(
    config.codeAgentUrl,
    `/issue-groups/${encodeURIComponent(groupKey)}/important`,
    accessToken,
    {
      method: 'POST',
      body: { important },
    },
  );
}
