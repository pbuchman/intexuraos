/**
 * Comment endpoints: addComment.
 */

import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type {
  LinearAgentClient,
  AddCommentRequest,
  AddCommentResponse,
  LinearAgentError,
} from '../../../../domain/ports/linearAgentClient.js';
import { fetchLinearAgent } from '../linear-fetch-util.js';

export interface CommentEndpointsDeps {
  baseUrl: string;
  internalAuthToken: string;
  timeoutMs: number;
  logger: Logger;
}

type CommentEndpoints = Pick<LinearAgentClient, 'addComment'>;

export function createCommentEndpoints(deps: CommentEndpointsDeps): CommentEndpoints {
  const { baseUrl, internalAuthToken, timeoutMs, logger } = deps;

  return {
    async addComment(
      request: AddCommentRequest
    ): Promise<Result<AddCommentResponse, LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/${encodeURIComponent(request.issueId)}/comments`;

      logger.info({ issueId: request.issueId }, 'Adding comment to Linear issue');

      const result = await fetchLinearAgent<{ id: string }>({
        url,
        method: 'POST',
        internalAuthToken,
        timeoutMs,
        userId: request.userId,
        body: { body: request.body },
      });

      if (result.kind === 'http-error') {
        logger.error(
          { status: result.status, error: result.errorText },
          'linear-agent addComment failed'
        );
        if (result.status === 429) {
          return err({ code: 'RATE_LIMITED', message: 'Linear API rate limited' });
        }
        if (result.status >= 500) {
          return err({ code: 'UNAVAILABLE', message: 'linear-agent unavailable' });
        }
        return err({ code: 'INVALID_REQUEST', message: result.errorText });
      }

      if (result.kind === 'invalid-body') {
        logger.error({ body: result.body }, 'Invalid response from linear-agent');
        return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
      }

      if (result.kind === 'timeout') {
        logger.error({ timeoutMs }, 'linear-agent request timed out');
        return err({ code: 'UNAVAILABLE', message: 'Request timed out' });
      }

      if (result.kind === 'network-error') {
        logger.error({ error: result.error }, 'linear-agent addComment request failed');
        return err({ code: 'UNKNOWN', message: getErrorMessage(result.error) });
      }

      logger.info(
        { issueId: request.issueId, commentId: result.data.id },
        'Comment added to Linear issue'
      );
      return ok({ commentId: result.data.id });
    },
  };
}
