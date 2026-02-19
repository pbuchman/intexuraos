/**
 * Linear Agent API client implementation.
 *
 * Wraps Linear's GraphQL API for agent activities and session management.
 * Uses the stored OAuth access token (actor=app mode) for authentication.
 */

import { ok, err, getErrorMessage, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  LinearAgentApiClient,
  LinearAgentApiError,
  EmitActivityRequest,
  UpdateSessionPlanRequest,
  UpdateSessionExternalUrlRequest,
} from '../../domain/ports/linearAgentApiClient.js';
import type { LinearOAuthRepository } from '../../domain/ports/linearOAuthRepository.js';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

export interface LinearAgentApiClientDeps {
  linearOAuthRepo: LinearOAuthRepository;
  logger: Logger;
}

/**
 * Execute a GraphQL mutation against the Linear API.
 */
async function executeGraphQL(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
  logger: Logger
): Promise<Result<unknown, LinearAgentApiError>> {
  try {
    const response = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error({ status: response.status, body: text }, 'Linear API request failed');
      return err({
        code: response.status === 401 ? 'UNAUTHORIZED' : 'UNAVAILABLE',
        message: `Linear API returned ${String(response.status)}: ${text}`,
      });
    }

    const data = await response.json() as { errors?: { message: string }[]; data?: unknown };

    /* v8 ignore start -- upstream: Linear API error format may vary @preserve */
    if (data.errors !== undefined && data.errors.length > 0) {
      const errorMessage = data.errors.map((e) => e.message).join(', ');
      logger.error({ errors: data.errors }, 'Linear GraphQL errors');
      return err({
        code: 'INVALID_REQUEST',
        message: `GraphQL errors: ${errorMessage}`,
      });
    }
    /* v8 ignore stop @preserve */

    return ok(data.data);
  } catch (error) {
    const message = getErrorMessage(error);
    logger.error({ error }, 'Failed to execute Linear GraphQL request');
    return err({
      code: 'UNAVAILABLE',
      message: `Network error: ${message}`,
    });
  }
}

/**
 * Create a Linear Agent API client.
 */
export function createLinearAgentApiClient(
  deps: LinearAgentApiClientDeps
): LinearAgentApiClient {
  const { linearOAuthRepo, logger } = deps;

  /**
   * Get access token from any stored workspace credentials.
   * For now, we support a single workspace installation.
   */
  async function getAccessToken(): Promise<Result<string, LinearAgentApiError>> {
    // Find any stored credentials (single-workspace for now)
    // The webhook handler will pass workspace context in future iterations
    const result = await linearOAuthRepo.get('default');
    if (!result.ok) {
      return err({
        code: 'UNAVAILABLE',
        message: result.error.message,
      });
    }

    if (result.value === null) {
      return err({
        code: 'UNAUTHORIZED',
        message: 'No Linear OAuth credentials found. Install the app first.',
      });
    }

    return ok(result.value.accessToken);
  }

  return {
    async emitActivity(request: EmitActivityRequest): Promise<Result<void, LinearAgentApiError>> {
      const tokenResult = await getAccessToken();
      if (!tokenResult.ok) {
        return tokenResult;
      }

      const mutation = `
        mutation AgentActivityCreate($input: AgentActivityCreateInput!) {
          agentActivityCreate(input: $input) {
            success
          }
        }
      `;

      const variables = {
        input: {
          agentSessionId: request.sessionId,
          content: {
            type: request.type,
            body: request.body,
          },
        },
      };

      logger.debug(
        { sessionId: request.sessionId, type: request.type },
        'Emitting Linear agent activity'
      );

      const result = await executeGraphQL(tokenResult.value, mutation, variables, logger);
      if (!result.ok) {
        return result;
      }

      return ok(undefined);
    },

    async updateSessionPlan(request: UpdateSessionPlanRequest): Promise<Result<void, LinearAgentApiError>> {
      const tokenResult = await getAccessToken();
      if (!tokenResult.ok) {
        return tokenResult;
      }

      const mutation = `
        mutation AgentSessionUpdate($id: String!, $input: AgentSessionUpdateInput!) {
          agentSessionUpdate(id: $id, input: $input) {
            success
          }
        }
      `;

      const variables = {
        id: request.sessionId,
        input: {
          plan: request.plan.map((step) => ({
            content: step.content,
            status: step.status,
          })),
        },
      };

      logger.debug(
        { sessionId: request.sessionId, stepCount: request.plan.length },
        'Updating Linear agent session plan'
      );

      const result = await executeGraphQL(tokenResult.value, mutation, variables, logger);
      if (!result.ok) {
        return result;
      }

      return ok(undefined);
    },

    async updateSessionExternalUrls(request: UpdateSessionExternalUrlRequest): Promise<Result<void, LinearAgentApiError>> {
      const tokenResult = await getAccessToken();
      if (!tokenResult.ok) {
        return tokenResult;
      }

      const mutation = `
        mutation AgentSessionUpdate($id: String!, $input: AgentSessionUpdateInput!) {
          agentSessionUpdate(id: $id, input: $input) {
            success
          }
        }
      `;

      const variables = {
        id: request.sessionId,
        input: {
          addedExternalUrls: request.externalUrls,
        },
      };

      logger.debug(
        { sessionId: request.sessionId, urlCount: request.externalUrls.length },
        'Updating Linear agent session external URLs'
      );

      const result = await executeGraphQL(tokenResult.value, mutation, variables, logger);
      if (!result.ok) {
        return result;
      }

      return ok(undefined);
    },
  };
}
