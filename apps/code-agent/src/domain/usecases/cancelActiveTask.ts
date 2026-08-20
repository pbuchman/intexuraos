import { err, ok, type Logger, type Result } from '@intexuraos/common-core';
import type { CodeTask } from '../models/codeTask.js';
import type {
  CodeTaskRepository,
  RepositoryError,
} from '../repositories/codeTaskRepository.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { TaskDispatcherService } from '../services/taskDispatcher.js';

const CANCELLABLE_STATUSES = new Set(['queued', 'dispatched', 'running']);

export type CancelActiveTaskErrorCode =
  | 'task_not_found'
  | 'invalid_nonce'
  | 'nonce_expired'
  | 'not_owner'
  | 'task_not_cancellable'
  | 'internal_error';

export interface CancelActiveTaskError {
  code: CancelActiveTaskErrorCode;
  message: string;
}

export interface CancelActiveTaskDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  taskDispatcher: TaskDispatcherService;
  workerSettingsRepo: WorkerSettingsRepository;
}

export interface CancelActiveTaskRequest {
  taskId: string;
  userId: string;
  nonce?: string;
  now?: Date;
}

type PreparationOutcome =
  | { kind: 'cancelled'; task: CodeTask }
  | { kind: 'worker_stop_required'; task: CodeTask; dispatchToken?: string }
  | { kind: 'rejected'; error: CancelActiveTaskError };

type FinalizationOutcome = Exclude<PreparationOutcome, { kind: 'worker_stop_required' }>;

function getDispatchToken(task: CodeTask): string | undefined {
  return task.dispatchToken;
}

function rejection(
  code: CancelActiveTaskErrorCode,
  message: string,
): { kind: 'rejected'; error: CancelActiveTaskError } {
  return { kind: 'rejected', error: { code, message } };
}

function validateRequest(
  task: CodeTask,
  request: CancelActiveTaskRequest,
): CancelActiveTaskError | null {
  if (request.nonce !== undefined) {
    if (task.cancelNonce === undefined || task.cancelNonce !== request.nonce) {
      return { code: 'invalid_nonce', message: 'Invalid cancel nonce' };
    }

    if (task.cancelNonceExpiresAt !== undefined) {
      const expiresAt = new Date(task.cancelNonceExpiresAt);
      if (expiresAt < (request.now ?? new Date())) {
        return { code: 'nonce_expired', message: 'Cancel nonce has expired' };
      }
    }
  }

  if (task.userId !== request.userId) {
    return { code: 'not_owner', message: 'Not authorized to cancel this task' };
  }

  if (!CANCELLABLE_STATUSES.has(task.status)) {
    return {
      code: 'task_not_cancellable',
      message: `Task is ${task.status}, cannot cancel`,
    };
  }

  return null;
}

function cancellationUpdate(request: CancelActiveTaskRequest): {
  status: 'cancelled';
  cancelNonce?: null;
  cancelNonceExpiresAt?: null;
} {
  return request.nonce === undefined
    ? { status: 'cancelled' }
    : { status: 'cancelled', cancelNonce: null, cancelNonceExpiresAt: null };
}

async function prepareCancellation(
  deps: CancelActiveTaskDeps,
  request: CancelActiveTaskRequest,
): Promise<Result<PreparationOutcome, RepositoryError>> {
  const { codeTaskRepo } = deps;
  if (codeTaskRepo.runInTransaction === undefined) {
    return err({
      code: 'FIRESTORE_ERROR',
      message: 'Atomic task cancellation is unavailable',
    });
  }

  return await codeTaskRepo.runInTransaction<PreparationOutcome>(async (transaction) => {
    const taskResult = await codeTaskRepo.findById(request.taskId, { transaction });
    if (!taskResult.ok) {
      return taskResult.error.code === 'NOT_FOUND'
        ? ok(rejection('task_not_found', 'Task not found'))
        : err(taskResult.error);
    }

    const task = taskResult.value;
    const validationError = validateRequest(task, request);
    if (validationError !== null) {
      return ok({ kind: 'rejected', error: validationError });
    }

    if (task.status !== 'queued') {
      const dispatchToken = getDispatchToken(task);
      return ok({
        kind: 'worker_stop_required',
        task,
        ...(dispatchToken !== undefined && { dispatchToken }),
      });
    }

    const updateResult = await codeTaskRepo.update(
      request.taskId,
      cancellationUpdate(request),
      { transaction },
    );
    if (!updateResult.ok) return err(updateResult.error);
    return ok({ kind: 'cancelled', task: updateResult.value });
  });
}

async function finalizeWorkerCancellation(
  deps: CancelActiveTaskDeps,
  request: CancelActiveTaskRequest,
  preparedTask: CodeTask,
  preparedDispatchToken: string | undefined,
): Promise<Result<FinalizationOutcome, RepositoryError>> {
  const { codeTaskRepo } = deps;
  if (codeTaskRepo.runInTransaction === undefined) {
    return err({
      code: 'FIRESTORE_ERROR',
      message: 'Atomic task cancellation is unavailable',
    });
  }

  return await codeTaskRepo.runInTransaction<FinalizationOutcome>(async (transaction) => {
    const currentResult = await codeTaskRepo.findById(request.taskId, { transaction });
    if (!currentResult.ok) {
      return currentResult.error.code === 'NOT_FOUND'
        ? ok(rejection('task_not_found', 'Task not found'))
        : err(currentResult.error);
    }

    const current = currentResult.value;
    if (current.status === 'cancelled') {
      return ok({ kind: 'cancelled', task: current });
    }
    if (!CANCELLABLE_STATUSES.has(current.status)) {
      return ok(rejection(
        'task_not_cancellable',
        `Task is ${current.status}, cannot cancel`,
      ));
    }
    if (current.userId !== request.userId) {
      return ok(rejection('not_owner', 'Not authorized to cancel this task'));
    }

    if (
      current.status !== 'queued'
      && getDispatchToken(current) !== preparedDispatchToken
    ) {
      deps.logger.error({
        taskId: request.taskId,
        preparedDispatchToken,
        currentDispatchToken: getDispatchToken(current),
      }, 'Task dispatch changed while cancellation was in flight');
      return ok(rejection(
        'internal_error',
        'Task dispatch changed while cancellation was in progress',
      ));
    }

    const updateResult = await codeTaskRepo.update(
      request.taskId,
      cancellationUpdate(request),
      { transaction },
    );
    if (!updateResult.ok) return err(updateResult.error);

    deps.logger.info({
      taskId: request.taskId,
      previousStatus: current.status,
      workerLocation: preparedTask.workerLocation,
    }, 'Worker-confirmed task cancellation finalized');
    return ok({ kind: 'cancelled', task: updateResult.value });
  });
}

function mapRepositoryFailure(error: RepositoryError): CancelActiveTaskError {
  return error.code === 'NOT_FOUND'
    ? { code: 'task_not_found', message: 'Task not found' }
    : { code: 'internal_error', message: 'Failed to cancel task' };
}

export async function cancelActiveTask(
  deps: CancelActiveTaskDeps,
  request: CancelActiveTaskRequest,
): Promise<Result<{ cancelled: true; task: CodeTask }, CancelActiveTaskError>> {
  const preparationResult = await prepareCancellation(deps, request);
  if (!preparationResult.ok) {
    deps.logger.error(
      { taskId: request.taskId, error: preparationResult.error },
      'Failed to prepare atomic task cancellation',
    );
    return err(mapRepositoryFailure(preparationResult.error));
  }

  const preparation = preparationResult.value;
  if (preparation.kind === 'rejected') {
    return err(preparation.error);
  }
  if (preparation.kind === 'cancelled') {
    return ok({ cancelled: true, task: preparation.task });
  }

  const settingsResult = await deps.workerSettingsRepo.getSettings(request.userId);
  if (!settingsResult.ok || settingsResult.value === null) {
    deps.logger.warn(
      { taskId: request.taskId, workerLocation: preparation.task.workerLocation },
      'Cannot confirm cancellation because worker settings are unavailable',
    );
    return err({
      code: 'internal_error',
      message: 'Worker cancellation could not be confirmed; task remains active',
    });
  }

  const worker = settingsResult.value.workers.find(
    (candidate) => candidate.name === preparation.task.workerLocation,
  );
  if (worker === undefined) {
    deps.logger.warn(
      { taskId: request.taskId, workerLocation: preparation.task.workerLocation },
      'Cannot confirm cancellation because the active worker is not configured',
    );
    return err({
      code: 'internal_error',
      message: 'Worker cancellation could not be confirmed; task remains active',
    });
  }

  try {
    await deps.taskDispatcher.cancelOnWorker(
      request.taskId,
      preparation.task.workerLocation,
      {
        url: worker.url,
        cfAccessClientId: worker.cfAccessClientId,
        cfAccessClientSecret: worker.cfAccessClientSecret,
      },
    );
  } catch (error) {
    deps.logger.warn(
      { taskId: request.taskId, workerLocation: preparation.task.workerLocation, error },
      'Worker did not confirm task cancellation; task remains active',
    );
    return err({
      code: 'internal_error',
      message: 'Worker cancellation could not be confirmed; task remains active',
    });
  }

  const finalizeResult = await finalizeWorkerCancellation(
    deps,
    request,
    preparation.task,
    preparation.dispatchToken,
  );
  if (!finalizeResult.ok) {
    deps.logger.error(
      { taskId: request.taskId, error: finalizeResult.error },
      'Worker stopped but task cancellation could not be finalized',
    );
    return err(mapRepositoryFailure(finalizeResult.error));
  }

  const finalized = finalizeResult.value;
  if (finalized.kind === 'rejected') {
    return err(finalized.error);
  }
  return ok({ cancelled: true, task: finalized.task });
}
