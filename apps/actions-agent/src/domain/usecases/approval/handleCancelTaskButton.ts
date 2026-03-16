import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { HandleApprovalReplyDeps } from '../handleApprovalReply.js';
import type { ApprovalReplyResult } from './types.js';

export async function handleCancelTaskButton(
  taskId: string,
  nonce: string | undefined, // @allow-undefined-type -- function param from array destructure, not an interface property
  userId: string,
  whatsappPublisher: HandleApprovalReplyDeps['whatsappPublisher'],
  codeAgentClient: HandleApprovalReplyDeps['codeAgentClient'],
  logger: Logger
): Promise<Result<ApprovalReplyResult>> {
  logger.info({ taskId, userId, hasNonce: nonce !== undefined }, 'Handling cancel-task button');

  if (codeAgentClient === undefined) {
    logger.error({ taskId }, 'Code agent client not configured for cancel-task');
    await whatsappPublisher.publishSendMessage({
      userId,
      message: 'Unable to cancel task: service temporarily unavailable.',
      correlationId: `cancel-task-error-${taskId}`,
    });
    return err(new Error('Code agent client not configured'));
  }

  if (nonce === undefined) {
    logger.warn({ taskId }, 'Cancel-task button missing nonce');
    await whatsappPublisher.publishSendMessage({
      userId,
      message: 'Unable to cancel task: missing security code.',
      correlationId: `cancel-task-error-${taskId}`,
    });
    return err(new Error('Cancel-task button missing nonce'));
  }

  const result = await codeAgentClient.cancelTaskWithNonce({ taskId, nonce, userId });

  if (!result.ok) {
    const errorMessages: Record<string, string> = {
      'TASK_NOT_FOUND': 'Task not found.',
      'INVALID_NONCE': 'Invalid cancel code. The code may have already been used.',
      'NONCE_EXPIRED': 'Cancel link has expired.',
      'NOT_OWNER': 'You are not the owner of this task.',
      'TASK_NOT_CANCELLABLE': 'Task cannot be cancelled (it may have already completed).',
    };
    const message = errorMessages[result.error.code] ?? 'Unable to cancel task.';

    logger.warn(
      { taskId, errorCode: result.error.code, errorMessage: result.error.message },
      'Failed to cancel task with nonce'
    );

    await whatsappPublisher.publishSendMessage({
      userId,
      message,
      correlationId: `cancel-task-error-${taskId}`,
    });

    return ok({
      matched: true,
      outcome: 'rejected',
    });
  }

  logger.info({ taskId }, 'Task cancelled successfully via button');

  await whatsappPublisher.publishSendMessage({
    userId,
    message: '🛑 Task cancellation requested.',
    correlationId: `cancel-task-success-${taskId}`,
  });

  return ok({
    matched: true,
    outcome: 'rejected',
  });
}
