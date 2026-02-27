import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { WebhookEventGroup } from './models.js';
import type { CodeTask } from '../models/codeTask.js';
import type { RepositoryError } from '../repositories/codeTaskRepository.js';
import { groupWebhookEvent } from './eventFamilies.js';

export interface WebhookEventInput {
  eventType: string;
  action: string | null;
  senderLogin: string;
  repository: string;
  pullRequestNumber: number | null;
  body: string | null;
}

export interface WebhookEventContext {
  eventGroup: WebhookEventGroup;
  senderAllowed: boolean;
  existingTask: CodeTask | null;
  userMapping: UserMapping | null;
}

export interface UserMapping {
  userId: string;
  senderLogin: string;
}

export type ContextLoadError =
  | { code: 'TASK_LOOKUP_FAILED'; message: string }
  | { code: 'USER_LOOKUP_FAILED'; message: string };

export interface ContextLoaderDeps {
  findTaskByPR: (
    repository: string,
    prNumber: number
  ) => Promise<Result<CodeTask | null, RepositoryError>>;
  resolveUser: (senderLogin: string) => Promise<UserMapping | null>;
  isSenderAllowed: (senderLogin: string) => boolean;
}

export async function loadWebhookEventContext(
  deps: ContextLoaderDeps,
  input: WebhookEventInput
): Promise<Result<WebhookEventContext, ContextLoadError>> {
  const eventGroup = groupWebhookEvent(input.eventType, input.action);
  const senderAllowed = deps.isSenderAllowed(input.senderLogin);

  let existingTask: CodeTask | null = null;
  if (input.pullRequestNumber !== null) {
    const taskResult = await deps.findTaskByPR(
      input.repository,
      input.pullRequestNumber
    );
    if (!taskResult.ok) {
      return err({
        code: 'TASK_LOOKUP_FAILED',
        message: taskResult.error.message,
      });
    }
    existingTask = taskResult.value;
  }

  let userMapping: UserMapping | null = null;
  if (senderAllowed) {
    userMapping = await deps.resolveUser(input.senderLogin);
  }

  return ok({
    eventGroup,
    senderAllowed,
    existingTask,
    userMapping,
  });
}
