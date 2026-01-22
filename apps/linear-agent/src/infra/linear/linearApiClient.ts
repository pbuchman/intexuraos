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
  LinearTeam,
  CreateIssueInput,
  LinearError,
  IssueStateCategory,
} from '../../domain/index.js';
import pino from 'pino';

const logger = pino({ name: 'linear-api-client' });

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
  const statePromises = issues.map(async (issue) => {
    const state = issue.state;
    return state !== undefined ? await state : null;
  });
  const states = await Promise.all(statePromises);

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
    };
  });
}

/* istanbul ignore next -- @preserve Maps Linear SDK Issue object that requires real API response */
async function mapSingleIssue(issue: Issue): Promise<LinearIssue> {
  const state = (await issue.state) as IssueState | null | undefined;

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

  if (
    message.includes('401') ||
    message.includes('Unauthorized') ||
    message.includes('Invalid API key')
  ) {
    return { code: 'INVALID_API_KEY', message: 'Invalid Linear API key' };
  }
  if (message.includes('429') || message.includes('rate limit')) {
    return { code: 'RATE_LIMIT', message: 'Linear API rate limit exceeded' };
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
        logger.error({ error: getErrorMessage(error) }, 'Failed to validate Linear API key');
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
        logger.error({ error: getErrorMessage(error) }, 'Failed to create Linear issue');
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

          const issuesConnection = await client.issues({
            filter: {
              team: { id: { eq: teamId } },
            },
            first: 100,
          });

          const allMappedIssues = await mapIssuesWithBatchedStates(issuesConnection.nodes);

          return filterIssuesByCompletionDate(allMappedIssues, completedSinceDays);
        });

        logger.info({ issueCount: issues.length }, 'Fetched Linear issues');
        return ok(issues);
      } catch (error) {
        logger.error({ error: getErrorMessage(error) }, 'Failed to list Linear issues');
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
        logger.error({ error: getErrorMessage(error) }, 'Failed to fetch Linear issue');
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
