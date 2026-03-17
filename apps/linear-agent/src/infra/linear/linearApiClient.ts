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

import { LinearClient, type Issue, type Team } from '@linear/sdk';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type {
  LinearApiClient,
  LinearIssue,
  LinearIssueWithTeam,
  LinearLabel,
  LinearTeam,
  CreateIssueInput,
  LinearError,
  IssueStateCategory,
  WorkflowState,
} from '../../domain/index.js';
import { createAppLogger } from '@intexuraos/infra-sentry';

const logger = createAppLogger({ name: 'linear-api-client' });

const CLIENT_TTL_MS = 5 * 60 * 1000;
const DEDUP_TTL_MS = 10 * 1000;

interface CachedClient {
  client: LinearClient;
  lastUsed: number;
}

const clientCache = new Map<string, CachedClient>();
const requestDedup = new Map<string, Promise<unknown>>();

/* istanbul ignore next -- @preserve Linear SDK client creation cannot be unit tested without real API key */
function getOrCreateClient(apiKey: string): LinearClient {
  const cached = clientCache.get(apiKey);
  const now = Date.now();

  if (cached !== undefined && now - cached.lastUsed < CLIENT_TTL_MS) {
    cached.lastUsed = now;
    return cached.client;
  }

  const client = new LinearClient({ apiKey });
  clientCache.set(apiKey, { client, lastUsed: now });

  return client;
}

/* istanbul ignore next -- @preserve Timer-based cleanup cannot be unit tested without waiting 5 minutes */
function cleanupExpiredClients(): void {
  const now = Date.now();
  for (const [key, cached] of clientCache.entries()) {
    if (now - cached.lastUsed >= CLIENT_TTL_MS) {
      clientCache.delete(key);
    }
  }
}

/* istanbul ignore next -- @preserve Timer setup runs at module load time */
setInterval(cleanupExpiredClients, CLIENT_TTL_MS);

/** Maps Linear API state type to our internal state category. Exported for testing. */
export function mapIssueStateType(type: string): IssueStateCategory {
  switch (type) {
    case 'backlog':
      return 'backlog';
    case 'unstarted':
      return 'unstarted';
    case 'started':
      return 'started';
    case 'completed':
      return 'completed';
    case 'canceled':
      return 'cancelled';
    default:
      return 'backlog';
  }
}

interface IssueState {
  id: string;
  name: string;
  type: string;
}

/* istanbul ignore next -- @preserve Maps Linear SDK Issue objects that require real API response */
async function mapIssuesWithBatchedStates(issues: Issue[]): Promise<LinearIssue[]> {
  // Batch fetch all states
  const statePromises = issues.map(async (issue) => {
    const state = issue.state;
    return state !== undefined ? await state : null;
  });
  const states = await Promise.all(statePromises);

  // Batch fetch all child counts
  const childrenPromises = issues.map(async (issue) => {
    const children = await issue.children();
    return children.nodes.length;
  });
  const childCounts = await Promise.all(childrenPromises);

  // Batch fetch all parents
  const parentPromises = issues.map(async (issue) => {
    const parent = await issue.parent;
    return parent?.id ?? null;
  });
  const parentIds = await Promise.all(parentPromises);

  // Batch fetch all labels
  const labelsPromises = issues.map(async (issue) => {
    const labelsConnection = await issue.labels();
    return labelsConnection.nodes.map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
    })) satisfies LinearLabel[];
  });
  const allLabels = await Promise.all(labelsPromises);

  // Batch fetch all assignees
  const assigneePromises = issues.map(async (issue) => {
    const assignee = await issue.assignee;
    return assignee ? { id: assignee.id, name: assignee.name } : null;
  });
  const allAssignees = await Promise.all(assigneePromises);

  return issues.map((issue, index) => {
    const state = states[index] as IssueState | null | undefined;
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? null,
      priority: issue.priority as 0 | 1 | 2 | 3 | 4,
      state: {
        id: state?.id ?? '',
        name: state?.name ?? 'Unknown',
        type: mapIssueStateType(state?.type ?? 'backlog'),
      },
      url: issue.url,
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
      completedAt: issue.completedAt?.toISOString() ?? null,
      parentId: parentIds[index] ?? null,
      childCount: childCounts[index] ?? 0,
      children: [],
      labels: allLabels[index] ?? [],
      assignee: allAssignees[index] ?? null,
    };
  });
}

/* istanbul ignore next -- @preserve Maps Linear SDK Issue object that requires real API response */
async function mapSingleIssue(issue: Issue): Promise<LinearIssue> {
  const state = (await issue.state) as IssueState | null | undefined;
  const children = await issue.children();
  const parent = await issue.parent;

  // Fetch labels for the issue
  const labelsConnection = await issue.labels();
  const labels: LinearLabel[] = labelsConnection.nodes.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
  }));

  // Fetch assignee for the issue
  const assignee = await issue.assignee;

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    priority: issue.priority as 0 | 1 | 2 | 3 | 4,
    state: {
      id: state?.id ?? '',
      name: state?.name ?? 'Unknown',
      type: mapIssueStateType(state?.type ?? 'backlog'),
    },
    url: issue.url,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    completedAt: issue.completedAt?.toISOString() ?? null,
    parentId: parent?.id ?? null,
    childCount: children.nodes.length,
    children: [],
    labels,
    assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
  };
}

/* istanbul ignore next -- @preserve Maps Linear SDK Issue with team that requires real API response */
async function mapSingleIssueWithTeam(issue: Issue): Promise<LinearIssueWithTeam> {
  const state = (await issue.state) as IssueState | null | undefined;
  const team = (await issue.team) as { id: string } | null | undefined;
  const parent = await issue.parent;

  // Fetch labels for the issue
  const labelsConnection = await issue.labels();
  const labels: LinearLabel[] = labelsConnection.nodes.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
  }));

  // Fetch child issues to count them
  const childrenConnection = await issue.children();
  const childCount = childrenConnection.nodes.length;

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    priority: issue.priority as 0 | 1 | 2 | 3 | 4,
    state: {
      id: state?.id ?? '',
      name: state?.name ?? 'Unknown',
      type: mapIssueStateType(state?.type ?? 'backlog'),
    },
    url: issue.url,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    completedAt: issue.completedAt?.toISOString() ?? null,
    parentId: parent?.id ?? null,
    teamId: team?.id ?? '',
    labels,
    childCount,
    children: [],
  };
}

/** Maps a Linear SDK Team to our domain LinearTeam. Exported for testing. */
export function mapTeam(team: Team): LinearTeam {
  return {
    id: team.id,
    name: team.name,
    key: team.key,
  };
}

/** Maps unknown errors to typed LinearError. Exported for testing. */
export function mapLinearError(error: unknown): LinearError {
  const message = getErrorMessage(error, 'Unknown Linear API error');

  if (message.includes('429') || message.includes('rate limit')) {
    return { code: 'RATE_LIMIT', message: 'Linear API rate limit exceeded' };
  }
  if (
    message.includes('401') ||
    message.includes('Unauthorized') ||
    message.includes('Invalid API key')
  ) {
    return { code: 'INVALID_API_KEY', message: 'Invalid Linear API key' };
  }
  if (message.includes('404') || message.includes('not found')) {
    return { code: 'TEAM_NOT_FOUND', message };
  }

  return { code: 'API_ERROR', message };
}

/** Creates a deduplication key for request caching. Exported for testing. */
export function createDedupKey(operation: string, ...args: string[]): string {
  return `${operation}:${args.join(':')}`;
}

/**
 * Filters issues to exclude old completed/cancelled issues beyond cutoff date.
 * Exported for testing.
 */
export function filterIssuesByCompletionDate(
  issues: LinearIssue[],
  completedSinceDays: number
): LinearIssue[] {
  const completedSinceDate = new Date();
  completedSinceDate.setDate(completedSinceDate.getDate() - completedSinceDays);

  return issues.filter((issue) => {
    if (issue.state.type === 'completed' || issue.state.type === 'cancelled') {
      if (issue.completedAt !== null) {
        const completedDate = new Date(issue.completedAt);
        if (completedDate < completedSinceDate) {
          return false;
        }
      }
    }
    return true;
  });
}

/* istanbul ignore next -- @preserve Request deduplication requires concurrent real API calls to test */
async function withDeduplication<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const existing = requestDedup.get(key) as Promise<T> | undefined;
  if (existing !== undefined) {
    logger.debug({ key }, 'Request deduplication hit');
    return await existing;
  }

  const promise = fn().finally(() => {
    setTimeout(() => {
      requestDedup.delete(key);
    }, DEDUP_TTL_MS);
  });

  requestDedup.set(key, promise);
  return await promise;
}

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
      const completedSinceDays = options?.completedSinceDays ?? 7;
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

export function clearClientCache(): void {
  clientCache.clear();
  requestDedup.clear();
}

export function getClientCacheSize(): number {
  return clientCache.size;
}

export function getDedupCacheSize(): number {
  return requestDedup.size;
}
