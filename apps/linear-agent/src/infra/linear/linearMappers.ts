/**
 * Pure mapping functions for Linear API responses.
 * These functions transform Linear SDK types to our internal domain types.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { type Issue, type Team } from '@linear/sdk';
import { getErrorMessage } from '@intexuraos/common-core';
import type {
  LinearIssue,
  LinearIssueWithTeam,
  LinearLabel,
  LinearTeam,
  LinearError,
  IssueStateCategory,
} from '../../domain/index.js';

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
export async function mapIssuesWithBatchedStates(issues: Issue[]): Promise<LinearIssue[]> {
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
export async function mapSingleIssue(issue: Issue): Promise<LinearIssue> {
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
export async function mapSingleIssueWithTeam(issue: Issue): Promise<LinearIssueWithTeam> {
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

/**
 * Detects transient upstream 5xx errors in error messages from the Linear SDK.
 * The SDK embeds HTTP status codes in the thrown Error message (e.g.
 * "GraphQL Error (Code: 502) - ..."), so classification is done by message
 * inspection rather than a structured error code.
 */
export function isTransientUpstreamError(error: unknown): boolean {
  const message = getErrorMessage(error, '');
  return /\(Code:\s*50[234]\)/.test(message);
}

/** Maps unknown errors to typed LinearError. Exported for testing. */
export function mapLinearError(error: unknown): LinearError {
  const message = getErrorMessage(error, 'Unknown Linear API error');

  // Check transient upstream 5xx first: the Linear SDK embeds the status code
  // in the thrown Error message (e.g. "GraphQL Error (Code: 502) - <html>..."),
  // and the body may contain unrelated digits/tokens that would otherwise
  // misclassify the error as 401/404.
  if (isTransientUpstreamError(error)) {
    // Replace potentially-bloated raw error body (e.g. Cloudflare HTML) with a clean message.
    return { code: 'UPSTREAM_UNAVAILABLE', message: 'Linear API temporarily unavailable' };
  }
  if (message.includes('429') || message.includes('rate limit')) {
    return { code: 'RATE_LIMIT', message: 'Linear API rate limit exceeded' };
  }
  if (
    message.includes('401') ||
    message.includes('Unauthorized') ||
    message.includes('Invalid API key') ||
    message.includes('Authentication required, not authenticated')
  ) {
    return { code: 'INVALID_API_KEY', message: 'Invalid Linear API key' };
  }
  if (message.includes('404') || message.includes('not found')) {
    return { code: 'TEAM_NOT_FOUND', message };
  }

  return { code: 'API_ERROR', message };
}

/**
 * Identifies transient Linear API failures (5xx server errors and transport-level
 * network errors) that should be retried with backoff before being reported to
 * the caller. Used to suppress noise from Cloudflare 502/503/504 gateway errors
 * during scheduled full syncs (Sentry: INT-1801).
 * Exported for testing.
 */
export function isTransientLinearError(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  const message = getErrorMessage(error, '').toLowerCase();
  if (message === '') return false;

  // 5xx server-side failures are transient by definition
  if (/\b(500|501|502|503|504|505|506|507|508|510|511)\b/.test(message)) {
    return true;
  }

  // Transport / network errors
  const transientNetworkPatterns = [
    'network request failed',
    'econnreset',
    'etimedout',
    'econnrefused',
    'enotfound',
    'eai_again',
    'fetch failed',
    'socket hang up',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
  ];
  return transientNetworkPatterns.some((pattern) => message.includes(pattern));
}

export interface RetryOnTransientOptions {
  /** Maximum number of retries (default: 3 = total of 4 attempts). */
  maxRetries?: number;
  /** Initial delay in ms; doubled each attempt (default: 500). */
  baseDelayMs?: number;
  /** Hard cap on delay between attempts in ms (default: 4000). */
  maxDelayMs?: number;
  /** Logger-like sink used for transient retry attempts (optional). */
  onRetry?: (info: {
    operationName: string;
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void;
}

/**
 * Run `op`, retrying on transient errors with exponential backoff.
 * Re-throws immediately on non-transient errors and re-throws the last
 * transient error after exhausting retries.
 * Exported for testing.
 */
export async function retryOnTransient<T>(
  op: () => Promise<T>,
  operationName: string,
  jitterSeed: number,
  options: RetryOnTransientOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 4000;
  // Bounded additive jitter derived from the seed; deterministic per call.
  const seedFraction = (Math.abs(jitterSeed) % 1000) / 1000;

  let attempt = 0;
  let lastError: unknown;
  while (attempt <= maxRetries) {
    try {
      return await op();
    } catch (error) {
      lastError = error;
      if (!isTransientLinearError(error) || attempt >= maxRetries) {
        throw error;
      }
      const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jitter = Math.floor(exponentialDelay * seedFraction * 0.25);
      const delayMs = Math.min(maxDelayMs, exponentialDelay + jitter);
      options.onRetry?.({ operationName, attempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
      attempt += 1;
    }
  }
  // Unreachable in practice: the inner branch either returns, throws, or
  // increments attempt; the loop guard ensures we exit only on the throw path.
  throw lastError;
}

/**
 * Default retention window for completed/cancelled issues (in days).
 * 60 days matches a ~2-month planning horizon; the previous 7-day default
 * caused completed issues to be pruned from Firestore too aggressively,
 * breaking the sync cycle for recently-closed work.
 */
export const DEFAULT_COMPLETED_SINCE_DAYS = 60;

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
