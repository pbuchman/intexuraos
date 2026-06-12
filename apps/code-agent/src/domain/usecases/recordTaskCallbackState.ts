import type { Logger } from '@intexuraos/common-core';
import { getServices } from '../../services.js';
import type {
  CodeTask,
  CodeTaskCallbackEndpoint,
} from '../models/codeTask.js';
import type { CodeTaskCallbackStateCreateInput } from '../repositories/codeTaskRepository.js';
import {
  buildTaskCompleteWebhookUrl,
  classifyCallbackOwner,
  normalizeCallbackBaseUrl,
} from '../services/codeTaskCallbackUrls.js';

function normalizeOptionalCallbackBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = baseUrl?.replace(/\/+$/, '') ?? '';
  if (trimmed === '') {
    return undefined;
  }

  try {
    return normalizeCallbackBaseUrl(trimmed);
  } catch {
    return trimmed;
  }
}

function buildOptionalWebhookUrl(callbackBaseUrl: string): string {
  try {
    return buildTaskCompleteWebhookUrl(callbackBaseUrl);
  } catch {
    return callbackBaseUrl;
  }
}

export function buildCallbackSuccessState(
  task: Pick<CodeTask, 'callbackState'>,
  endpoint: CodeTaskCallbackEndpoint,
  fallbackBaseUrl: string | undefined,
  now: Date
): CodeTaskCallbackStateCreateInput | undefined {
  const callbackBaseUrl = task.callbackState?.callbackBaseUrl
    ?? normalizeOptionalCallbackBaseUrl(fallbackBaseUrl);

  if (callbackBaseUrl === undefined) {
    return undefined;
  }

  return {
    webhookUrl: task.callbackState?.webhookUrl ?? buildOptionalWebhookUrl(callbackBaseUrl),
    callbackBaseUrl,
    owner: task.callbackState?.owner ?? classifyCallbackOwner(callbackBaseUrl),
    configuredAt: task.callbackState?.configuredAt ?? now,
    lastSuccessAt: now,
    lastSuccessEndpoint: endpoint,
  };
}

export async function recordTaskCallbackSuccess(
  taskId: string,
  endpoint: CodeTaskCallbackEndpoint,
  logger: Pick<Logger, 'warn'> | undefined
): Promise<void> {
  try {
    const services = getServices();
    const taskResult = await services.codeTaskRepo.findById(taskId);
    if (!taskResult.ok) {
      logger?.warn(
        { taskId, endpoint, error: taskResult.error },
        'Callback success state skipped because task was not found'
      );
      return;
    }

    const task = taskResult.value; // @allow-result-access -- narrowed by !taskResult.ok guard above
    const callbackState = buildCallbackSuccessState(
      task,
      endpoint,
      services.codeTaskCallbackBaseUrl,
      new Date()
    );
    if (callbackState === undefined) {
      logger?.warn(
        { taskId, endpoint },
        'Callback success state skipped because callback base URL is unavailable'
      );
      return;
    }

    const updateResult = await services.codeTaskRepo.update(taskId, { callbackState });
    if (!updateResult.ok) {
      logger?.warn(
        { taskId, endpoint, error: updateResult.error },
        'Failed to record callback success state'
      );
    }
  } catch (error) {
    logger?.warn(
      { taskId, endpoint, error },
      'Failed to record callback success state'
    );
  }
}
