import type { Logger } from '@intexuraos/common-core';
import type { WorkerSettingsRepository } from '../../ports/workerSettingsRepository.js';
import { sendTaskMessage } from '../../usecases/sendTaskMessage.js';
import type { WebhookDispatchResult, WebhookDispatchServiceDeps } from './types.js';

/**
 * Resolve worker credentials for a preserved task by looking up the user's
 * worker settings and matching on workerLocation. Shared by handleNewTask
 * (@worker destruction) and handlePrClose (merge cleanup).
 */
export async function resolveWorkerCredentials(
  workerSettingsRepo: WorkerSettingsRepository,
  userId: string,
  workerLocation: string,
): Promise<{ url: string; cfAccessClientId: string; cfAccessClientSecret: string } | undefined> {
  const settingsResult = await workerSettingsRepo.getSettings(userId);
  if (!settingsResult.ok || settingsResult.value === null) return undefined;
  const workerConfig = settingsResult.value.workers.find((w) => w.name === workerLocation);
  if (workerConfig?.enabled !== true) return undefined;
  return {
    url: workerConfig.url,
    cfAccessClientId: workerConfig.cfAccessClientId,
    cfAccessClientSecret: workerConfig.cfAccessClientSecret,
  };
}

export function resolveLoginForTaskCreation(senderLogin: string, repository: string, allowedBots: Set<string>): string {
  if (!allowedBots.has(senderLogin)) return senderLogin;
  const slashIndex = repository.indexOf('/');
  if (slashIndex <= 0) return senderLogin;
  const owner = repository.slice(0, slashIndex);
  // Only remap for personal forks (e.g. pbuchman/intexuraos),
  // not org repos (e.g. intexuraos/some-repo) where the owner is an org, not a user.
  if (owner === 'intexuraos') return senderLogin;
  return owner;
}

/**
 * Detect when a dispatch failure indicates the task is stale and no longer reachable.
 * Three scenarios: (1) task_not_found — task was found by PR lookup but deleted before
 * message send (Firestore-level race), (2) session_expired — the orchestrator detected
 * the worker container was cleaned up, (3) worker_error with "Task not found" — task
 * completed/crashed and was cleaned up on the worker but Firestore still has a record.
 *
 * Checks the structured error code first (preferred), then falls back to message
 * matching for worker_error responses where the code is generic.
 */
export function isStaleTaskError(result: WebhookDispatchResult): boolean {
  if (result.errorCode === 'task_not_found') return true;
  if (result.errorCode === 'session_expired') return true;
  if (result.errorCode === 'worker_error' && result.error !== undefined) {
    return result.error.includes('Task not found') || result.error.includes('HTTP 404');
  }
  return false;
}

/** Best-effort destroy a preserved container when @worker directive requires a fresh agent. */
export async function destroyPreservedContainer(
  deps: Pick<WebhookDispatchServiceDeps, 'workerSettingsRepo' | 'taskDispatcher'>,
  preserved: { id: string; userId: string; workerLocation: string },
  logger: Logger,
): Promise<void> {
  try {
    const workerCreds = await resolveWorkerCredentials(
      deps.workerSettingsRepo, preserved.userId, preserved.workerLocation,
    );
    await deps.taskDispatcher.cancelOnWorker(preserved.id, preserved.workerLocation, workerCreds);
  } catch (error) {
    logger.warn({ taskId: preserved.id, error }, 'Failed to destroy preserved container (best-effort)');
  }
}

/** Attempt to reuse a preserved pull_request container by sending it a message. */
export async function reusePreservedContainer(
  deps: Pick<WebhookDispatchServiceDeps, 'codeTaskRepo' | 'logLineRepo' | 'taskDispatcher' | 'workerSettingsRepo' | 'statusMirrorService' | 'whatsappNotifier'>,
  preserved: { id: string; userId: string },
  comment: string,
  logger: Logger,
): Promise<WebhookDispatchResult | null> {
  try {
    const sendResult = await sendTaskMessage(
      {
        logger,
        codeTaskRepo: deps.codeTaskRepo,
        logLineRepo: deps.logLineRepo,
        taskDispatcher: deps.taskDispatcher,
        workerSettingsRepo: deps.workerSettingsRepo,
        statusMirrorService: deps.statusMirrorService,
        whatsappNotifier: deps.whatsappNotifier,
      },
      { taskId: preserved.id, userId: preserved.userId, message: comment },
    );
    if (sendResult.ok) {
      return { success: true, dispatched: true };
    }
    logger.warn(
      { taskId: preserved.id, error: sendResult.error, _skipSentry: true },
      'Failed to send message to preserved container, falling through to new task',
    );
  } catch (error) {
    logger.warn(
      { taskId: preserved.id, error, _skipSentry: true },
      'Error sending to preserved container, falling through',
    );
  }
  return null;
}
