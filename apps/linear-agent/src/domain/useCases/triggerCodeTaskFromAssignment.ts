import { hasCodeTaskLabel, hasPlanningTaskLabel } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import type { CodeAgentClient } from '../ports.js';
import type { LinearWebhookEvent } from '../webhookTypes.js';

export interface TriggerCodeTaskDeps {
  codeAgentClient: CodeAgentClient;
  logger: Logger;
}

const ASSIGNMENT_PROMPT =
  'Analyze the linked Linear issue and all its comments (newest first). Enrich the description with requirements, acceptance criteria, and test plan. Then mark it ready for execution or flag it as unclear.';

const EXECUTION_PROMPT =
  'Implement the requirements defined in the linked Linear issue and its comments (newest first). Follow the test plan, write code, run CI, and create a PR.';

export function shouldTriggerCodeTask(event: LinearWebhookEvent): boolean {
  if (event.action !== 'update') return false;
  if (event.updatedFrom === undefined) return false;
  if (event.updatedFrom.assigneeId !== null) return false;
  if (event.data.assignee === null) return false;
  if (event.data.state.type !== 'backlog' && event.data.state.type !== 'unstarted') return false;

  // Require planning-task or code-task label to trigger
  const labelNames = event.data.labels.map((l) => l.name);
  if (!hasPlanningTaskLabel(labelNames) && !hasCodeTaskLabel(labelNames)) return false;

  return true;
}

export async function triggerCodeTaskFromAssignment(
  event: LinearWebhookEvent,
  userId: string,
  deps: TriggerCodeTaskDeps
): Promise<void> {
  const { codeAgentClient, logger } = deps;

  // Check if issue has code-task label to determine prompt
  const labelNames = event.data.labels.map((l) => l.name);
  const prompt = hasCodeTaskLabel(labelNames) ? EXECUTION_PROMPT : ASSIGNMENT_PROMPT;

  const result = await codeAgentClient.triggerCodeTask({
    userId,
    linearIssueId: event.data.identifier,
    prompt,
    workerType: 'auto',
    actionId: `webhook-assign-${event.data.identifier}-${String(event.webhookTimestamp)}`,
    approvalEventId: `webhook-assign-${event.data.identifier}-${String(event.webhookTimestamp)}`,
  });

  if (result.ok) {
    logger.info({ codeTaskId: result.value.codeTaskId, identifier: event.data.identifier }, 'Code task triggered from assignment');
  } else {
    logger.error({ error: result.error, identifier: event.data.identifier }, 'Failed to trigger code task from assignment');
  }
}
