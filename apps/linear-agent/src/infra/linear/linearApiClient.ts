/**
 * Linear API client using @linear/sdk.
 * Handles all communication with Linear's GraphQL API.
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

function mapIssueStateType(type: string): IssueStateCategory {
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

async function mapIssue(issue: Issue): Promise<LinearIssue> {
  const state = await issue.state;

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

function mapTeam(team: Team): LinearTeam {
  return {
    id: team.id,
    name: team.name,
    key: team.key,
  };
}

function mapLinearError(error: unknown): LinearError {
  const message = getErrorMessage(error, 'Unknown Linear API error');

  // Check for common error patterns
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

export function createLinearApiClient(): LinearApiClient {
  return {
    async validateAndGetTeams(apiKey: string): Promise<Result<LinearTeam[], LinearError>> {
      try {
        logger.info('Validating Linear API key and fetching teams');

        const client = new LinearClient({ apiKey });

        // Fetch viewer to validate API key (throws on auth failure)
        await client.viewer;

        // Fetch all teams the user has access to
        const teamsConnection = await client.teams();
        const teams = teamsConnection.nodes.map(mapTeam);

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

        const client = new LinearClient({ apiKey });

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
        if (!issue) {
          return err({ code: 'API_ERROR', message: 'Issue created but could not fetch details' });
        }

        const mapped = await mapIssue(issue);
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
      try {
        const completedSinceDays = options?.completedSinceDays ?? 7;

        logger.info({ teamId, completedSinceDays }, 'Listing Linear issues');

        const client = new LinearClient({ apiKey });

        // Calculate date filter for completed issues
        const completedSinceDate = new Date();
        completedSinceDate.setDate(completedSinceDate.getDate() - completedSinceDays);

        // Fetch all issues for the team
        // We'll filter completed issues client-side for simplicity
        const issuesConnection = await client.issues({
          filter: {
            team: { id: { eq: teamId } },
          },
          first: 100, // Reasonable limit for dashboard
        });

        const issues: LinearIssue[] = [];

        for (const issue of issuesConnection.nodes) {
          const mapped = await mapIssue(issue);

          // Filter out old completed issues
          if (mapped.state.type === 'completed' || mapped.state.type === 'cancelled') {
            if (mapped.completedAt !== null) {
              const completedDate = new Date(mapped.completedAt);
              if (completedDate < completedSinceDate) {
                continue; // Skip old completed issues
              }
            }
          }

          issues.push(mapped);
        }

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
      try {
        logger.info({ issueId }, 'Fetching Linear issue');

        const client = new LinearClient({ apiKey });

        const issue = await client.issue(issueId);
        const mapped = await mapIssue(issue);
        return ok(mapped);
      } catch (error) {
        logger.error({ error: getErrorMessage(error) }, 'Failed to fetch Linear issue');
        return err(mapLinearError(error));
      }
    },
  };
}
