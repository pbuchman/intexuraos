import type { Logger } from 'pino';
import type { CodeAgentClient } from '../ports.js';
import type { LinearWebhookEvent } from '../webhookTypes.js';

export interface TriggerCodeTaskDeps {
  codeAgentClient: CodeAgentClient;
  logger: Logger;
}

const ASSIGNMENT_PROMPT =
  'Analyze the linked Linear issue. Enrich the description with requirements, acceptance criteria, and test plan. Then mark it ready for execution or flag it as unclear.';

export function shouldTriggerCodeTask(event: LinearWebhookEvent): boolean {
  if (event.action !== 'update') return false;
  if (event.updatedFrom === undefined) return false;
  if (event.updatedFrom.assigneeId !== null) return false;
  if (event.data.assignee === null) return false;
  if (event.data.state.type !== 'unstarted') return false;
  if (event.data.labels.some(l => l.name === 'Code Task')) return false;

  return true;
}

export async function triggerCodeTaskFromAssignment(
  event: LinearWebhookEvent,
  userId: string,
  deps: TriggerCodeTaskDeps
): Promise<void> {
  const { codeAgentClient, logger } = deps;

  const result = await codeAgentClient.triggerCodeTask({
    userId,
    linearIssueId: event.data.identifier,
    prompt: ASSIGNMENT_PROMPT,
    workerType: 'auto',
    actionId: `webhook-assign-${event.webhookId}`,
    approvalEventId: `webhook-assign-${event.webhookId}`,
  });

  if (result.ok) {
    logger.info({ codeTaskId: result.value.codeTaskId, identifier: event.data.identifier }, 'Code task triggered from assignment');
  } else {
    logger.error({ error: result.error, identifier: event.data.identifier }, 'Failed to trigger code task from assignment');
  }
}
