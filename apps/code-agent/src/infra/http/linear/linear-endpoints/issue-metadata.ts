/**
 * Issue metadata endpoint: updateIssueMetadata.
 */

import type { Result } from '@intexuraos/common-core';
import { ok } from '@intexuraos/common-core';
import type {
  LinearAgentClient,
  LinearAgentError,
} from '../../../../domain/ports/linearAgentClient.js';
import { fetchLinearAgent } from '../linear-fetch-util.js';
import { isOk, mapSilentFetchError } from '../silent-fetch-mapper.js';

export interface IssueMetadataEndpointsDeps {
  baseUrl: string;
  internalAuthToken: string;
  timeoutMs: number;
}

type IssueMetadataEndpoints = Pick<LinearAgentClient, 'updateIssueMetadata'>;

export function createIssueMetadataEndpoints(
  deps: IssueMetadataEndpointsDeps
): IssueMetadataEndpoints {
  const { baseUrl, internalAuthToken, timeoutMs } = deps;

  return {
    async updateIssueMetadata(request: {
      userId: string;
      issueId: string;
      assigneeId?: string | null;
      addLabels?: string[];
      removeLabels?: string[];
    }): Promise<Result<{ droppedLabels: string[] }, LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/${encodeURIComponent(request.issueId)}/metadata`;

      const body: Record<string, unknown> = {};
      if (request.assigneeId !== undefined) body['assigneeId'] = request.assigneeId;
      if (request.addLabels !== undefined) body['addLabels'] = request.addLabels;
      if (request.removeLabels !== undefined) body['removeLabels'] = request.removeLabels;

      const result = await fetchLinearAgent<{ droppedLabels?: string[] }>({
        url,
        method: 'PATCH',
        internalAuthToken,
        timeoutMs,
        userId: request.userId,
        body,
        requireData: false,
      });

      if (!isOk(result)) return mapSilentFetchError(result);

      return ok({ droppedLabels: result.data?.droppedLabels ?? [] });
    },
  };
}
