/**
 * Maps Linear webhook/API payloads to SyncedLinearIssue.
 */
import type { SyncedLinearIssue, LinearIssue, LinearLabel } from './models.js';
import type { LinearWebhookPayload } from './webhookTypes.js';

/**
 * Map webhook payload to SyncedLinearIssue.
 * Note: Webhook labels don't include color, so we use empty string as default.
 * Full sync will populate the color field.
 */
export function mapWebhookToSyncedIssue(
  payload: LinearWebhookPayload,
  userId: string
): SyncedLinearIssue {
  const stateType = parseStateType(payload.state.type);
  const priority = parsePriority(payload.priority);

  const labels: LinearLabel[] = payload.labels.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color ?? '', // Webhook doesn't provide color
  }));

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
    labels,
    url: payload.url,
    userId,
    parentId: payload.parent?.id ?? null,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    syncedAt: new Date().toISOString(),
    teamId: payload.team.id,
  };
}

/**
 * Map Linear API issue to SyncedLinearIssue.
 * parentId is captured from Linear SDK during full sync.
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
    labels: issue.labels,
    url: issue.url,
    userId,
    parentId: issue.parentId ?? null,
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
