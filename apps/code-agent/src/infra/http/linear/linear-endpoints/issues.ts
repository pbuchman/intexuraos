/**
 * Issue-related endpoints for the linear-agent HTTP client.
 *
 * Covers: createIssue, updateIssueState, validateIssue, generateTitle,
 * fetchIssueForDisplay, fetchIssuesForDisplay, getIssueDescription,
 * getIssueContext.
 */

import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type {
  LinearAgentClient,
  CreateIssueRequest,
  CreateIssueResponse,
  UpdateIssueStateRequest,
  ValidateIssueRequest,
  ValidatedIssue,
  GenerateTitleRequest,
  GeneratedTitle,
  LinearAgentError,
  LinearIssueForDisplay,
  IssueContext,
} from '../../../../domain/ports/linearAgentClient.js';
import { fetchLinearAgent } from '../linear-fetch-util.js';

export interface IssueEndpointsDeps {
  baseUrl: string;
  internalAuthToken: string;
  timeoutMs: number;
  logger: Logger;
}

type IssueEndpoints = Pick<
  LinearAgentClient,
  | 'createIssue'
  | 'updateIssueState'
  | 'validateIssue'
  | 'generateTitle'
  | 'fetchIssueForDisplay'
  | 'fetchIssuesForDisplay'
  | 'getIssueDescription'
  | 'getIssueContext'
>;

export function createIssueEndpoints(deps: IssueEndpointsDeps): IssueEndpoints {
  const { baseUrl, internalAuthToken, timeoutMs, logger } = deps;

  return {
    async createIssue(
      request: CreateIssueRequest
    ): Promise<Result<CreateIssueResponse, LinearAgentError>> {
      const url = `${baseUrl}/internal/issues`;

      logger.info({ title: request.title }, 'Creating Linear issue via linear-agent');

      const result = await fetchLinearAgent<{
        id: string;
        identifier: string;
        title: string;
        url: string;
      }>({
        url,
        method: 'POST',
        internalAuthToken,
        timeoutMs,
        userId: request.userId,
        body: {
          title: request.title,
          description: request.description,
          labels: request.labels ?? [],
        },
      });

      if (result.kind === 'http-error') {
        logger.error(
          { status: result.status, error: result.errorText },
          'linear-agent createIssue failed'
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
        logger.error({ error: result.error }, 'linear-agent request failed');
        return err({ code: 'UNKNOWN', message: getErrorMessage(result.error) });
      }

      logger.info(
        { issueId: result.data.id, identifier: result.data.identifier },
        'Linear issue created'
      );
      return ok({
        issueId: result.data.id,
        issueIdentifier: result.data.identifier,
        issueTitle: result.data.title,
        issueUrl: result.data.url,
      });
    },

    async updateIssueState(
      request: UpdateIssueStateRequest
    ): Promise<Result<void, LinearAgentError>> {
      const url = `${baseUrl}/internal/issues/${request.issueId}/state`;

      logger.info(
        { issueId: request.issueId, state: request.state },
        'Updating Linear issue state'
      );

      const result = await fetchLinearAgent<unknown>({
        url,
        method: 'PATCH',
        internalAuthToken,
        timeoutMs,
        userId: request.userId,
        body: { state: request.state },
        requireData: false,
      });

      if (result.kind === 'http-error') {
        logger.error(
          { status: result.status, error: result.errorText },
          'linear-agent updateState failed'
        );
        return err({ code: 'UNAVAILABLE', message: result.errorText });
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
        logger.error({ error: result.error }, 'linear-agent updateState request failed');
        return err({ code: 'UNKNOWN', message: getErrorMessage(result.error) });
      }

      logger.info(
        { issueId: request.issueId, state: request.state },
        'Linear issue state updated'
      );
      return ok(undefined);
    },

    async validateIssue(
      request: ValidateIssueRequest
    ): Promise<Result<ValidatedIssue, LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/${encodeURIComponent(request.identifier)}/validate?userId=${encodeURIComponent(request.userId)}`;

      logger.info({ identifier: request.identifier }, 'Validating Linear issue via linear-agent');

      const result = await fetchLinearAgent<{
        id: string;
        identifier: string;
        title: string;
        url: string;
        labels: string[];
        childCount: number;
        parentId?: string | null;
      }>({
        url,
        method: 'GET',
        internalAuthToken,
        timeoutMs,
      });

      if (result.kind === 'http-error') {
        if (result.status === 404) {
          logger.warn(
            { identifier: request.identifier, error: result.errorText },
            'Linear issue not found or wrong team'
          );
          return err({
            code: 'NOT_FOUND',
            message: `Issue ${request.identifier} not found or belongs to different team`,
          });
        }
        logger.error(
          { status: result.status, error: result.errorText },
          'linear-agent validateIssue failed'
        );
        return err({ code: 'UNAVAILABLE', message: result.errorText });
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
        logger.error({ error: result.error }, 'linear-agent validateIssue request failed');
        return err({ code: 'UNKNOWN', message: getErrorMessage(result.error) });
      }

      logger.info(
        { identifier: request.identifier, issueId: result.data.id },
        'Linear issue validated'
      );
      return ok({
        id: result.data.id,
        identifier: result.data.identifier,
        title: result.data.title,
        url: result.data.url,
        labels: result.data.labels,
        childCount: result.data.childCount,
        parentId: result.data.parentId ?? null,
      });
    },

    async generateTitle(
      request: GenerateTitleRequest
    ): Promise<Result<GeneratedTitle, LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/generate-title`;

      logger.info(
        { descriptionLength: request.description.length },
        'Generating issue title via linear-agent'
      );

      const result = await fetchLinearAgent<{
        title: string;
        issueType: 'feature' | 'bug' | 'refactor' | 'research';
      }>({
        url,
        method: 'POST',
        internalAuthToken,
        timeoutMs,
        body: {
          description: request.description,
          userId: request.userId,
        },
      });

      if (result.kind === 'http-error') {
        logger.error(
          { status: result.status, error: result.errorText },
          'linear-agent generateTitle failed'
        );
        return err({ code: 'UNAVAILABLE', message: result.errorText });
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
        logger.error({ error: result.error }, 'linear-agent generateTitle request failed');
        return err({ code: 'UNKNOWN', message: getErrorMessage(result.error) });
      }

      logger.info(
        { title: result.data.title, issueType: result.data.issueType },
        'Issue title generated'
      );
      return ok({
        title: result.data.title,
        issueType: result.data.issueType,
      });
    },

    async fetchIssueForDisplay(
      request: ValidateIssueRequest
    ): Promise<Result<LinearIssueForDisplay, LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/${encodeURIComponent(request.identifier)}`;

      logger.info({ identifier: request.identifier }, 'Fetching Linear issue for display');

      const result = await fetchLinearAgent<{
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
      }>({
        url,
        method: 'GET',
        internalAuthToken,
        timeoutMs,
        userId: request.userId,
      });

      if (result.kind === 'http-error') {
        logger.warn(
          { status: result.status, error: result.errorText },
          'linear-agent fetchIssueForDisplay failed'
        );
        return err({ code: 'UNAVAILABLE', message: result.errorText });
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
        logger.error(
          { error: result.error },
          'linear-agent fetchIssueForDisplay request failed'
        );
        return err({ code: 'UNKNOWN', message: getErrorMessage(result.error) });
      }

      return ok({
        identifier: result.data.identifier,
        parentIdentifier: result.data.parentIdentifier,
        title: result.data.title,
        state: result.data.state,
        priority: result.data.priority,
        assignee: result.data.assignee,
        labels: result.data.labels,
        url: result.data.url,
        commentCount: result.data.commentCount,
        lastCommentAt: result.data.lastCommentAt,
      });
    },

    async fetchIssuesForDisplay(request: {
      userId: string;
      identifiers: string[];
    }): Promise<Result<LinearIssueForDisplay[], LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/display-batch`;

      logger.info(
        { issueCount: request.identifiers.length },
        'Fetching Linear issues for display'
      );

      const result = await fetchLinearAgent<{ issues: LinearIssueForDisplay[] }>({
        url,
        method: 'POST',
        internalAuthToken,
        timeoutMs,
        userId: request.userId,
        body: { identifiers: request.identifiers },
      });

      if (result.kind === 'http-error') {
        logger.warn(
          { status: result.status, error: result.errorText },
          'linear-agent fetchIssuesForDisplay failed'
        );
        return err({ code: 'UNAVAILABLE', message: result.errorText });
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
        logger.error(
          { error: result.error },
          'linear-agent fetchIssuesForDisplay request failed'
        );
        return err({ code: 'UNKNOWN', message: getErrorMessage(result.error) });
      }

      return ok(result.data.issues);
    },

    async getIssueDescription(
      request: ValidateIssueRequest
    ): Promise<Result<string | undefined, LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/${encodeURIComponent(request.identifier)}`;

      const result = await fetchLinearAgent<{ description: string | null }>({
        url,
        method: 'GET',
        internalAuthToken,
        timeoutMs,
        userId: request.userId,
      });

      if (result.kind === 'http-error') {
        logger.info(
          { status: result.status, error: result.errorText },
          'linear-agent getIssueDescription failed'
        );
        return err({ code: 'UNAVAILABLE', message: result.errorText });
      }

      if (result.kind === 'invalid-body') {
        return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
      }

      if (result.kind === 'timeout') {
        return err({ code: 'UNAVAILABLE', message: 'Request timed out' });
      }

      if (result.kind === 'network-error') {
        return err({ code: 'UNKNOWN', message: getErrorMessage(result.error) });
      }

      return ok(result.data.description ?? undefined);
    },

    async getIssueContext(request: {
      identifier: string;
    }): Promise<Result<IssueContext, LinearAgentError>> {
      const url = `${baseUrl}/internal/linear/issues/${encodeURIComponent(request.identifier)}/context`;

      const result = await fetchLinearAgent<{
        description: string | null;
        comments: { body: string; createdAt: string }[];
      }>({
        url,
        method: 'GET',
        internalAuthToken,
        timeoutMs,
      });

      if (result.kind === 'http-error') {
        if (result.status === 404) {
          return err({ code: 'NOT_FOUND', message: result.errorText });
        }
        logger.warn(
          { status: result.status, error: result.errorText },
          'linear-agent getIssueContext failed'
        );
        return err({ code: 'UNAVAILABLE', message: result.errorText });
      }

      if (result.kind === 'invalid-body') {
        return err({ code: 'UNKNOWN', message: 'Invalid response from linear-agent' });
      }

      if (result.kind === 'timeout') {
        return err({ code: 'UNAVAILABLE', message: 'Request timed out' });
      }

      if (result.kind === 'network-error') {
        return err({ code: 'UNKNOWN', message: getErrorMessage(result.error) });
      }

      return ok({ description: result.data.description, comments: result.data.comments });
    },
  };
}
