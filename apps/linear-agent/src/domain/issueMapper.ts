/**
 * Maps Linear webhook/API payloads to SyncedLinearIssue.
 */
import type { SyncedLinearIssue, LinearIssue } from './models.js';
import type { LinearWebhookPayload } from './webhookTypes.js';

/**
 * Map webhook payload to SyncedLinearIssue.
 */
export function mapWebhookToSyncedIssue(
  payload: LinearWebhookPayload,
  userId: string
): SyncedLinearIssue {
  const stateType = parseStateType(payload.state.type);
  const priority = parsePriority(payload.priority);

  return {
    id: payload.id,
    identifier: payload.identifier,
    title: payload.title,
    description: payload.description,
    state: payload.state.name,
    stateType,
    priority,
    assigneeId: payload.assignee?.id ?? null,
    assigneeName: payload.assignee?.name ?? null,
    labels: payload.labels.map((l) => l.name),
    url: payload.url,
    userId,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    syncedAt: new Date().toISOString(),
    teamId: payload.team.id,
  };
}

/**
 * Map Linear API issue to SyncedLinearIssue.
 */
export function mapApiIssueToSyncedIssue(
  issue: LinearIssue,
  userId: string,
  teamId: string
): SyncedLinearIssue {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    state: issue.state.name,
    stateType: issue.state.type,
    priority: issue.priority,
    assigneeId: null, // API LinearIssue doesn't include assignee
    assigneeName: null,
    labels: [], // API LinearIssue doesn't include labels array
    url: issue.url,
    userId,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    syncedAt: new Date().toISOString(),
    teamId,
  };
}

function parseStateType(type: string): 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled' {
  const validTypes = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'] as const;
  if (validTypes.includes(type as 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled')) {
    return type as 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';
  }
  return 'unstarted';
}

function parsePriority(priority: number): 0 | 1 | 2 | 3 | 4 {
  if (priority >= 0 && priority <= 4) {
    return priority as 0 | 1 | 2 | 3 | 4;
  }
  return 0;
}
