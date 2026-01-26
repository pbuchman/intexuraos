/**
 * HTTP client implementation for linear-agent communication.
 *
 * Design doc: docs/designs/INT-156-code-action-type.md (lines 207-308)
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  LinearAgentClient,
  CreateIssueRequest,
  CreateIssueResponse,
  UpdateIssueStateRequest,
  LinearAgentError,
} from '../../domain/ports/linearAgentClient.js';

export interface LinearAgentHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  timeoutMs: number;
}

export function createLinearAgentHttpClient(
  config: LinearAgentHttpClientConfig,
  logger: Logger
): LinearAgentClient {
  const { baseUrl, internalAuthToken, timeoutMs } = config;

  return {
    async createIssue(request: CreateIssueRequest): Promise<Result<CreateIssueResponse, LinearAgentError>> {
      const url = `${baseUrl}/internal/issues`;

      logger.info({ title: request.title }, 'Creating Linear issue via linear-agent');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': internalAuthToken,
          },
          body: JSON.stringify({
            title: request.title,
            description: request.description,
            labels: request.labels ?? ['Code Task'],
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'linear-agent createIssue failed');

          if (response.status === 429) {
            return err({ code: 'RATE_LIMITED', message: 'Linear API rate limited' });
          }
          if (response.status >= 500) {
            return err({ code: 'UNAVAILABLE', message: 'linear-agent unavailable' });
          }
          return err({ code: 'INVALID_REQUEST', message: errorText });
        }

        const data = await response.json() as {
          id: string;
          identifier: string;
          title: string;
          url: string;
        };

        logger.info({ issueId: data.id, identifier: data.identifier }, 'Linear issue created');

        return ok({
          issueId: data.id,
          issueIdentifier: data.identifier,
          issueTitle: data.title,
          issueUrl: data.url,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          logger.error({ timeoutMs }, 'linear-agent request timed out');
          return err({ code: 'UNAVAILABLE', message: 'Request timed out' });
        }

        logger.error({ error }, 'linear-agent request failed');
        return err({ code: 'UNKNOWN', message: String(error) });
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async updateIssueState(request: UpdateIssueStateRequest): Promise<Result<void, LinearAgentError>> {
      const url = `${baseUrl}/internal/issues/${request.issueId}/state`;

      logger.info({ issueId: request.issueId, state: request.state }, 'Updating Linear issue state');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': internalAuthToken,
          },
          body: JSON.stringify({ state: request.state }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'linear-agent updateState failed');
          return err({ code: 'UNAVAILABLE', message: errorText });
        }

        logger.info({ issueId: request.issueId, state: request.state }, 'Linear issue state updated');
        return ok(undefined);
      } catch (error) {
        logger.error({ error }, 'linear-agent updateState request failed');
        return err({ code: 'UNKNOWN', message: String(error) });
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
