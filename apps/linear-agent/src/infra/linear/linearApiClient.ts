/**
 * Linear API client using @linear/sdk.
 * Handles all communication with Linear's GraphQL API.
 *
 * OPTIMIZATIONS (INT-95):
 * 1. Client caching: Reuses LinearClient instances per API key to leverage SDK optimizations
 * 2. Batch state fetching: Uses Promise.all to fetch states in parallel instead of N+1 queries
 * 3. Request deduplication: Caches in-flight requests to prevent duplicate API calls
 * 4. TTL-based cache invalidation: Clients expire after 5 minutes of inactivity
 */

import { type Issue } from '@linear/sdk';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type {
  LinearApiClient,
  LinearIssue,
  LinearIssueWithTeam,
  LinearTeam,
  CreateIssueInput,
  LinearError,
  WorkflowState,
} from '../../domain/index.js';
import { createAppLogger } from '@intexuraos/infra-sentry';

import {
  mapIssueStateType,
  mapTeam,
  mapLinearError,
  filterIssuesByCompletionDate,
  mapIssuesWithBatchedStates,
  DEFAULT_COMPLETED_SINCE_DAYS,
  mapSingleIssue,
  mapSingleIssueWithTeam,
} from './linearMappers.js';
import {
  getOrCreateClient,
  withDeduplication,
  createDedupKey,
  clearClientCache,
  getClientCacheSize,
  getDedupCacheSize,
} from './requestCache.js';

const logger = createAppLogger({ name: 'linear-api-client' });

// Re-export functions for backward compatibility with existing tests
export {
  mapIssueStateType,
  mapTeam,
  mapLinearError,
  createDedupKey,
  filterIssuesByCompletionDate,
  DEFAULT_COMPLETED_SINCE_DAYS,
  clearClientCache,
  getClientCacheSize,
  getDedupCacheSize,
};

/* istanbul ignore next -- @preserve API client methods require real Linear API key to test */
export function createLinearApiClient(): LinearApiClient {
  return {
    async validateAndGetTeams(apiKey: string): Promise<Result<LinearTeam[], LinearError>> {
      const dedupKey = createDedupKey('validateAndGetTeams', apiKey.slice(0, 8));

      try {
        const teams = await withDeduplication(dedupKey, async () => {
          logger.info('Validating Linear API key and fetching teams');

          const client = getOrCreateClient(apiKey);

          await client.viewer;

          const teamsConnection = await client.teams();
          return teamsConnection.nodes.map(mapTeam);
        });

        logger.info({ teamCount: teams.length }, 'Successfully validated API key');
        return ok(teams);
      } catch (error) {
        logger.error({ error }, 'Failed to validate Linear API key');
        return err(mapLinearError(error));
      }
    },

    async createIssue(
      apiKey: string,
      input: CreateIssueInput
    ): Promise<Result<LinearIssue, LinearError>> {
      try {
        logger.info({ teamId: input.teamId, title: input.title }, 'Creating Linear issue');

        const client = getOrCreateClient(apiKey);

        const payload = await client.createIssue({
          teamId: input.teamId,
          title: input.title,
          ...(input.description !== null ? { description: input.description } : {}),
          priority: input.priority,
        });

        if (!payload.success) {
          return err({ code: 'API_ERROR', message: 'Failed to create issue' });
        }

        const issue = await payload.issue;
        if (issue === undefined) {
          return err({ code: 'API_ERROR', message: 'Issue created but could not fetch details' });
        }

        const mapped = await mapSingleIssue(issue);
        logger.info(
          { issueId: mapped.id, identifier: mapped.identifier },
          'Issue created successfully'
        );

        return ok(mapped);
      } catch (error) {
        logger.error({ error, teamId: input.teamId }, 'Failed to create Linear issue');
        return err(mapLinearError(error));
      }
    },

    async listIssues(
      apiKey: string,
      teamId: string,
      options?: { completedSinceDays?: number }
    ): Promise<Result<LinearIssue[], LinearError>> {
      const completedSinceDays =
        options?.completedSinceDays ?? DEFAULT_COMPLETED_SINCE_DAYS;
      const dedupKey = createDedupKey(
        'listIssues',
        apiKey.slice(0, 8),
        teamId,
        String(completedSinceDays)
      );

      try {
        const issues = await withDeduplication(dedupKey, async () => {
          logger.info({ teamId, completedSinceDays }, 'Listing Linear issues');

          const client = getOrCreateClient(apiKey);

          // Paginate through all issues
          const allIssues: Issue[] = [];
          let hasMore = true;
          let after: string | undefined;

          while (hasMore) {
            const issuesConnection = await client.issues({
              filter: {
                team: { id: { eq: teamId } },
              },
              first: 100,
              ...(after !== undefined ? { after } : {}),
            });

            allIssues.push(...issuesConnection.nodes);
            hasMore = issuesConnection.pageInfo.hasNextPage;
            after = issuesConnection.pageInfo.endCursor;
          }

          logger.info({ totalIssues: allIssues.length }, 'Fetched all pages');

          const allMappedIssues = await mapIssuesWithBatchedStates(allIssues);

          return filterIssuesByCompletionDate(allMappedIssues, completedSinceDays);
        });

        logger.info({ issueCount: issues.length }, 'Fetched Linear issues');
        return ok(issues);
      } catch (error) {
        logger.error({ error, teamId }, 'Failed to list Linear issues');
        return err(mapLinearError(error));
      }
    },

    async getIssue(
      apiKey: string,
      issueId: string
    ): Promise<Result<LinearIssue | null, LinearError>> {
      const dedupKey = createDedupKey('getIssue', apiKey.slice(0, 8), issueId);

      try {
        const mapped = await withDeduplication(dedupKey, async () => {
          logger.info({ issueId }, 'Fetching Linear issue');

          const client = getOrCreateClient(apiKey);

          const issue = await client.issue(issueId);
          return await mapSingleIssue(issue);
        });

        return ok(mapped);
      } catch (error) {
        logger.error({ error, issueId }, 'Failed to fetch Linear issue');
        return err(mapLinearError(error));
      }
    },

    async getIssueByIdentifier(
      apiKey: string,
      identifier: string
    ): Promise<Result<LinearIssueWithTeam | null, LinearError>> {
      const dedupKey = createDedupKey('getIssueByIdentifier', apiKey.slice(0, 8), identifier);

      try {
        const mapped = await withDeduplication(dedupKey, async () => {
          logger.info({ identifier }, 'Fetching Linear issue by identifier');

          const client = getOrCreateClient(apiKey);

          const issue = await client.issue(identifier);

          return await mapSingleIssueWithTeam(issue);
        });

        return ok(mapped);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        if (errorMessage.includes('not found') || errorMessage.includes('Entity not found')) {
          logger.info({ identifier }, 'Issue not found by identifier');
          return ok(null);
        }
        logger.error({ error, identifier }, 'Failed to fetch Linear issue by identifier');
        return err(mapLinearError(error));
      }
    },

    async updateIssueState(
      apiKey: string,
      issueId: string,
      stateId: string
    ): Promise<Result<LinearIssue, LinearError>> {
      try {
        logger.info({ issueId, stateId }, 'Updating Linear issue state');
        const client = getOrCreateClient(apiKey);
        const payload = await client.updateIssue(issueId, { stateId });

        if (!payload.success) {
          return err({ code: 'API_ERROR', message: 'Failed to update issue state' });
        }

        const issue = await payload.issue;
        if (issue === undefined) {
          return err({ code: 'API_ERROR', message: 'Issue updated but could not fetch details' });
        }

        const mapped = await mapSingleIssue(issue);
        logger.info({ issueId, newState: mapped.state.name }, 'Issue state updated');
        return ok(mapped);
      } catch (error) {
        logger.error({ error, issueId, stateId }, 'Failed to update Linear issue state');
        return err(mapLinearError(error));
      }
    },

    async updateIssue(
      apiKey: string,
      issueId: string,
      input: { assigneeId?: string | null; labelIds?: string[]; parentId?: string | null }
    ): Promise<Result<LinearIssue, LinearError>> {
      try {
        logger.info({ issueId, input }, 'Updating Linear issue metadata');
        const client = getOrCreateClient(apiKey);
        const payload = await client.updateIssue(issueId, {
          ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
          ...(input.labelIds !== undefined && { labelIds: input.labelIds }),
          ...(input.parentId !== undefined && { parentId: input.parentId }),
        });

        if (!payload.success) {
          return err({ code: 'API_ERROR', message: 'Failed to update issue metadata' });
        }

        const issue = await payload.issue;
        if (issue === undefined) {
          return err({ code: 'API_ERROR', message: 'Issue updated but could not fetch details' });
        }

        return ok(await mapSingleIssue(issue));
      } catch (error) {
        logger.error({ error, issueId, input }, 'Failed to update Linear issue metadata');
        return err(mapLinearError(error));
      }
    },

    async createComment(
      apiKey: string,
      issueId: string,
      body: string
    ): Promise<Result<{ id: string }, LinearError>> {
      try {
        logger.info({ issueId }, 'Creating Linear comment');
        const client = getOrCreateClient(apiKey);
        const payload = await client.createComment({ issueId, body });
        if (!payload.success) {
          return err({ code: 'API_ERROR', message: 'Failed to create comment' });
        }
        const comment = await payload.comment;
        if (comment === undefined) {
          return err({ code: 'API_ERROR', message: 'Comment created but could not fetch details' });
        }
        return ok({ id: comment.id });
      } catch (error) {
        logger.error({ error, issueId }, 'Failed to create Linear comment');
        return err(mapLinearError(error));
      }
    },

    async listIssueLabels(
      apiKey: string,
      teamId: string
    ): Promise<Result<{ id: string; name: string; color: string }[], LinearError>> {
      try {
        logger.info({ teamId }, 'Listing Linear issue labels');
        const client = getOrCreateClient(apiKey);
        const labelsConnection = await client.issueLabels({
          filter: { team: { id: { eq: teamId } } },
          first: 250,
        });
        return ok(
          labelsConnection.nodes.map((label) => ({
            id: label.id,
            name: label.name,
            color: label.color,
          }))
        );
      } catch (error) {
        logger.error({ error, teamId }, 'Failed to list Linear issue labels');
        return err(mapLinearError(error));
      }
    },

    async getWorkflowStates(
      apiKey: string,
      teamId: string
    ): Promise<Result<WorkflowState[], LinearError>> {
      const dedupKey = createDedupKey('getWorkflowStates', apiKey.slice(0, 8), teamId);

      try {
        const states = await withDeduplication(dedupKey, async () => {
          logger.info({ teamId }, 'Fetching Linear workflow states');

          const client = getOrCreateClient(apiKey);
          const statesConnection = await client.workflowStates({
            filter: { team: { id: { eq: teamId } } },
          });

          return statesConnection.nodes.map((s) => ({
            id: s.id,
            name: s.name,
            type: mapIssueStateType(s.type),
          }));
        });

        logger.info({ teamId, stateCount: states.length }, 'Fetched Linear workflow states');
        return ok(states);
      } catch (error) {
        logger.error({ error, teamId }, 'Failed to fetch Linear workflow states');
        return err(mapLinearError(error));
      }
    },
  };
}
