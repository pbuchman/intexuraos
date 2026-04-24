/**
 * Issue metadata endpoint: updateIssueMetadata.
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type {
  LinearAgentClient,
  LinearAgentError,
} from '../../../../domain/ports/linearAgentClient.js';
import { fetchLinearAgent } from '../linear-fetch-util.js';

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

      if (result.kind === 'http-error') {
        return err({
          code: result.status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE',
          message: result.errorText,
        });
      }

      if (result.kind === 'invalid-body') {
        return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
      }

      if (result.kind === 'timeout') {
        return err({ code: 'UNKNOWN', message: 'Request timed out' });
      }

      if (result.kind === 'network-error') {
        return err({ code: 'UNKNOWN', message: getErrorMessage(result.error) });
      }

      return ok({ droppedLabels: result.data?.droppedLabels ?? [] });
    },
  };
}
