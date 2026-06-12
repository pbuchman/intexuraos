/**
 * Issue tree endpoints: fetchIssueTree, fetchDirectChildrenLive.
 *
 * These endpoints are silent (no method-level logging) — they map fetch
 * results directly to LinearAgentError per the original behavior.
 */

import type { Result } from '@intexuraos/common-core';
import { ok } from '@intexuraos/common-core';
import type {
  LinearAgentClient,
  IssueTreeNode,
  IssueTreeResponse,
  DirectChildrenRequest,
  LinearAgentError,
} from '../../../../domain/ports/linearAgentClient.js';
import { fetchLinearAgent } from '../linear-fetch-util.js';
import { isOk, mapSilentFetchError } from '../silent-fetch-mapper.js';

export interface IssueTreeEndpointsDeps {
  baseUrl: string;
  internalAuthToken: string;
  timeoutMs: number;
}

type IssueTreeEndpoints = Pick<
  LinearAgentClient,
  'fetchIssueTree' | 'fetchDirectChildrenLive'
>;

export function createIssueTreeEndpoints(
  deps: IssueTreeEndpointsDeps
): IssueTreeEndpoints {
  const { baseUrl, internalAuthToken, timeoutMs } = deps;

  return {
    async fetchIssueTree(request: {
      userId: string;
      issueId: string;
    }): Promise<Result<IssueTreeResponse, LinearAgentError>> {
      const url = `${baseUrl}/internal/issues/${encodeURIComponent(request.issueId)}/tree`;

      const result = await fetchLinearAgent<IssueTreeResponse>({
        url,
        method: 'GET',
        internalAuthToken,
        timeoutMs,
        userId: request.userId,
      });

      if (!isOk(result)) return mapSilentFetchError(result);

      return ok(result.data);
    },

    async fetchDirectChildrenLive(
      request: DirectChildrenRequest
    ): Promise<Result<IssueTreeNode[], LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/${encodeURIComponent(request.issueId)}/direct-children`;

      const result = await fetchLinearAgent<IssueTreeNode[]>({
        url,
        method: 'GET',
        internalAuthToken,
        timeoutMs,
        userId: request.userId,
      });

      if (!isOk(result)) return mapSilentFetchError(result);

      return ok(result.data);
    },
  };
}
