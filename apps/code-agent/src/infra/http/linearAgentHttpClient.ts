/**
 * HTTP client implementation for linear-agent communication.
 *
 * Design doc: docs/designs/INT-156-code-action-type.md (lines 207-308)
 */

import type {
  Result,
} from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  LinearAgentClient,
  CreateIssueRequest,
  CreateIssueResponse,
  UpdateIssueStateRequest,
  ValidateIssueRequest,
  ValidatedIssue,
  GenerateTitleRequest,
  GeneratedTitle,
  AddCommentRequest,
  AddCommentResponse,
  IssueTreeResponse,
  LinearAgentError,
  LinearIssueForDisplay,
  IssueContext,
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
            'X-User-Id': request.userId,
          },
          body: JSON.stringify({
            title: request.title,
            description: request.description,
            labels: request.labels ?? [],
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

        const body = await response.json() as {
          success: boolean;
          data?: {
            id: string;
            identifier: string;
            title: string;
            url: string;
          };
        };

        if (!body.success || body.data === undefined) {
          logger.error({ body }, 'Invalid response from linear-agent');
          return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
        }

        logger.info({ issueId: body.data.id, identifier: body.data.identifier }, 'Linear issue created');

        return ok({
          issueId: body.data.id,
          issueIdentifier: body.data.identifier,
          issueTitle: body.data.title,
          issueUrl: body.data.url,
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
            'X-User-Id': request.userId,
          },
          body: JSON.stringify({ state: request.state }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'linear-agent updateState failed');
          return err({ code: 'UNAVAILABLE', message: errorText });
        }

        const body = await response.json() as {
          success: boolean;
          data?: unknown;
        };

        if (!body.success) {
          logger.error({ body }, 'Invalid response from linear-agent');
          return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
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

    async validateIssue(request: ValidateIssueRequest): Promise<Result<ValidatedIssue, LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/${encodeURIComponent(request.identifier)}/validate?userId=${encodeURIComponent(request.userId)}`;

      logger.info({ identifier: request.identifier }, 'Validating Linear issue via linear-agent');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-Internal-Auth': internalAuthToken,
          },
          signal: controller.signal,
        });

        if (response.status === 404) {
          const errorText = await response.text();
          logger.warn({ identifier: request.identifier, error: errorText }, 'Linear issue not found or wrong team');
          return err({ code: 'NOT_FOUND', message: `Issue ${request.identifier} not found or belongs to different team` });
        }

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'linear-agent validateIssue failed');
          return err({ code: 'UNAVAILABLE', message: errorText });
        }

        const body = await response.json() as {
          success: boolean;
          data?: {
            id: string;
            identifier: string;
            title: string;
            url: string;
            labels: string[];
            childCount: number;
            parentId?: string | null;
          };
        };

        if (!body.success || body.data === undefined) {
          logger.error({ body }, 'Invalid response from linear-agent');
          return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
        }

        logger.info({ identifier: request.identifier, issueId: body.data.id }, 'Linear issue validated');

        return ok({
          id: body.data.id,
          identifier: body.data.identifier,
          title: body.data.title,
          url: body.data.url,
          labels: body.data.labels,
          childCount: body.data.childCount,
          parentId: body.data.parentId ?? null,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          logger.error({ timeoutMs }, 'linear-agent request timed out');
          return err({ code: 'UNAVAILABLE', message: 'Request timed out' });
        }

        logger.error({ error }, 'linear-agent validateIssue request failed');
        return err({ code: 'UNKNOWN', message: String(error) });
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async generateTitle(request: GenerateTitleRequest): Promise<Result<GeneratedTitle, LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/generate-title`;

      logger.info({ descriptionLength: request.description.length }, 'Generating issue title via linear-agent');

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
            description: request.description,
            userId: request.userId,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'linear-agent generateTitle failed');
          return err({ code: 'UNAVAILABLE', message: errorText });
        }

        const body = await response.json() as {
          success: boolean;
          data?: {
            title: string;
            issueType: 'feature' | 'bug' | 'refactor' | 'research';
          };
        };

        if (!body.success || body.data === undefined) {
          logger.error({ body }, 'Invalid response from linear-agent');
          return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
        }

        logger.info({ title: body.data.title, issueType: body.data.issueType }, 'Issue title generated');

        return ok({
          title: body.data.title,
          issueType: body.data.issueType,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          logger.error({ timeoutMs }, 'linear-agent request timed out');
          return err({ code: 'UNAVAILABLE', message: 'Request timed out' });
        }

        logger.error({ error }, 'linear-agent generateTitle request failed');
        return err({ code: 'UNKNOWN', message: String(error) });
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async addComment(request: AddCommentRequest): Promise<Result<AddCommentResponse, LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/${encodeURIComponent(request.issueId)}/comments`;

      logger.info({ issueId: request.issueId }, 'Adding comment to Linear issue');

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
            'X-User-Id': request.userId,
          },
          body: JSON.stringify({ body: request.body }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'linear-agent addComment failed');

          if (response.status === 429) {
            return err({ code: 'RATE_LIMITED', message: 'Linear API rate limited' });
          }
          if (response.status >= 500) {
            return err({ code: 'UNAVAILABLE', message: 'linear-agent unavailable' });
          }
          return err({ code: 'INVALID_REQUEST', message: errorText });
        }

        const body = await response.json() as {
          success: boolean;
          data?: {
            id: string;
          };
        };

        if (!body.success || body.data === undefined) {
          logger.error({ body }, 'Invalid response from linear-agent');
          return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
        }

        logger.info({ issueId: request.issueId, commentId: body.data.id }, 'Comment added to Linear issue');

        return ok({
          commentId: body.data.id,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          logger.error({ timeoutMs }, 'linear-agent request timed out');
          return err({ code: 'UNAVAILABLE', message: 'Request timed out' });
        }

        logger.error({ error }, 'linear-agent addComment request failed');
        return err({ code: 'UNKNOWN', message: String(error) });
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async fetchIssueTree(request: { userId: string; issueId: string }): Promise<Result<IssueTreeResponse, LinearAgentError>> {
      const url = `${baseUrl}/internal/issues/${encodeURIComponent(request.issueId)}/tree`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-Internal-Auth': internalAuthToken,
            'X-User-Id': request.userId,
          },
          signal: controller.signal,
        });
        if (!response.ok) {
          const errorText = await response.text();
          return err({ code: response.status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE', message: errorText });
        }
        const body = await response.json() as { success: boolean; data?: IssueTreeResponse };
        if (!body.success || body.data === undefined) {
          return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
        }
        return ok(body.data);
      } catch (error) {
        return err({ code: 'UNKNOWN', message: String(error) });
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async updateIssueMetadata(request: {
      userId: string;
      issueId: string;
      assigneeId?: string | null;
      addLabels?: string[];
      removeLabels?: string[];
    }): Promise<Result<{ droppedLabels: string[] }, LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/${encodeURIComponent(request.issueId)}/metadata`;
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
            'X-User-Id': request.userId,
          },
          body: JSON.stringify({
            ...(request.assigneeId !== undefined && { assigneeId: request.assigneeId }),
            ...(request.addLabels !== undefined && { addLabels: request.addLabels }),
            ...(request.removeLabels !== undefined && { removeLabels: request.removeLabels }),
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const errorText = await response.text();
          return err({ code: response.status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE', message: errorText });
        }
        const body = await response.json() as { success: boolean; data?: { droppedLabels?: string[] } };
        if (!body.success) return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
        return ok({ droppedLabels: body.data?.droppedLabels ?? [] });
      } catch (error) {
        return err({ code: 'UNKNOWN', message: String(error) });
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async fetchIssueForDisplay(request: ValidateIssueRequest): Promise<Result<LinearIssueForDisplay, LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/${encodeURIComponent(request.identifier)}`;

      logger.info({ identifier: request.identifier }, 'Fetching Linear issue for display');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-Internal-Auth': internalAuthToken,
            'X-User-Id': request.userId,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.warn({ status: response.status, error: errorText }, 'linear-agent fetchIssueForDisplay failed');
          return err({ code: 'UNAVAILABLE', message: errorText });
        }

        const body = await response.json() as {
          success: boolean;
          data?: {
            id: string;
            identifier: string;
            parentIdentifier: string | null;
            title: string;
            description: string | null;
            state: { name: string; type: string };
            priority: number;
            assignee: { id: string; name: string } | null;
            labels: { id: string; name: string }[];
            url: string;
            createdAt: string;
            updatedAt: string;
            commentCount: number;
            lastCommentAt: string | null;
          };
        };

        if (!body.success || body.data === undefined) {
          logger.error({ body }, 'Invalid response from linear-agent');
          return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
        }

        return ok({
          identifier: body.data.identifier,
          parentIdentifier: body.data.parentIdentifier,
          title: body.data.title,
          state: body.data.state,
          priority: body.data.priority,
          assignee: body.data.assignee,
          labels: body.data.labels,
          url: body.data.url,
          commentCount: body.data.commentCount,
          lastCommentAt: body.data.lastCommentAt,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          logger.error({ timeoutMs }, 'linear-agent request timed out');
          return err({ code: 'UNAVAILABLE', message: 'Request timed out' });
        }

        logger.error({ error }, 'linear-agent fetchIssueForDisplay request failed');
        return err({ code: 'UNKNOWN', message: String(error) });
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async fetchIssuesForDisplay(request: {
      userId: string;
      identifiers: string[];
    }): Promise<Result<LinearIssueForDisplay[], LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/display-batch`;

      logger.info({ issueCount: request.identifiers.length }, 'Fetching Linear issues for display');

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
            'X-User-Id': request.userId,
          },
          body: JSON.stringify({
            identifiers: request.identifiers,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.warn({ status: response.status, error: errorText }, 'linear-agent fetchIssuesForDisplay failed');
          return err({ code: 'UNAVAILABLE', message: errorText });
        }

        const body = await response.json() as {
          success: boolean;
          data?: {
            issues: LinearIssueForDisplay[];
          };
        };

        if (!body.success || body.data === undefined) {
          logger.error({ body }, 'Invalid response from linear-agent');
          return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
        }

        return ok(body.data.issues);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          logger.error({ timeoutMs }, 'linear-agent request timed out');
          return err({ code: 'UNAVAILABLE', message: 'Request timed out' });
        }

        logger.error({ error }, 'linear-agent fetchIssuesForDisplay request failed');
        return err({ code: 'UNKNOWN', message: String(error) });
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async getIssueDescription(request: ValidateIssueRequest): Promise<Result<string | undefined, LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/${encodeURIComponent(request.identifier)}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-Internal-Auth': internalAuthToken,
            'X-User-Id': request.userId,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.info({ status: response.status, error: errorText }, 'linear-agent getIssueDescription failed');
          return err({ code: 'UNAVAILABLE', message: errorText });
        }

        const body = await response.json() as {
          success: boolean;
          data?: {
            description: string | null;
          };
        };

        if (!body.success || body.data === undefined) {
          return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
        }

        return ok(body.data.description ?? undefined);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return err({ code: 'UNAVAILABLE', message: 'Request timed out' });
        }
        return err({ code: 'UNKNOWN', message: String(error) });
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async getIssueContext(request: { identifier: string }): Promise<Result<IssueContext, LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/${encodeURIComponent(request.identifier)}/context`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-Internal-Auth': internalAuthToken,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          if (response.status === 404) {
            return err({ code: 'NOT_FOUND', message: errorText });
          }
          logger.warn({ status: response.status, error: errorText }, 'linear-agent getIssueContext failed');
          return err({ code: 'UNAVAILABLE', message: errorText });
        }

        const body = await response.json() as {
          success: boolean;
          data?: {
            description: string | null;
            comments: { body: string; createdAt: string }[];
          };
        };

        if (!body.success || body.data === undefined) {
          return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
        }

        return ok({ description: body.data.description, comments: body.data.comments });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return err({ code: 'UNAVAILABLE', message: 'Request timed out' });
        }
        return err({ code: 'UNKNOWN', message: String(error) });
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
