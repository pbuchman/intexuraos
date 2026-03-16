import type { Result, Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { HandleApprovalReplyDeps } from '../handleApprovalReply.js';
import type { ApprovalReplyResult } from './types.js';

/**
 * Handle proceed-implementation button (INT-628).
 * Button ID format: "proceed-implementation:{taskId}"
 */
export async function handleProceedToImplementationButton(
  taskId: string,
  userId: string,
  whatsappPublisher: HandleApprovalReplyDeps['whatsappPublisher'],
  codeAgentClient: HandleApprovalReplyDeps['codeAgentClient'],
  logger: Logger
): Promise<Result<ApprovalReplyResult>> {
  logger.info({ taskId, userId }, 'Handling proceed-implementation button');

  if (codeAgentClient === undefined) {
    logger.error({ taskId }, 'Code agent client not configured for proceed-implementation');
    const notifyResult = await whatsappPublisher.publishSendMessage({
      userId,
      message: 'Unable to start implementation: service temporarily unavailable.',
      correlationId: `proceed-implementation-error-${taskId}`,
    });
    if (!notifyResult.ok) {
      logger.warn({ taskId, error: notifyResult.error.message }, 'Failed to send error notification to user');
    }
    return err(new Error('Code agent client not configured'));
  }

  const result = await codeAgentClient.submitToPhase2({ taskId, userId });

  if (!result.ok) {
    const errorMessages: Record<string, string> = {
      'TASK_NOT_FOUND': 'Task not found.',
      'INVALID_STATUS': 'Task is not in designed status. It may have already been implemented.',
      'NO_LINEAR_ISSUE': 'Cannot proceed: no Linear issue attached to this task.',
      'LABEL_NOT_READY': 'Task is not ready for implementation. Required labels may be missing.',
      'ALREADY_IMPLEMENTED': 'Implementation has already started for this task.',
      'ACTIVE_TASK_EXISTS': 'An active task already exists for this request.',
      'WORKER_NOT_CONFIGURED': 'Unable to start implementation: no workers available.',
      'NETWORK_ERROR': 'Unable to start implementation: network error. Please try again.',
      'UNKNOWN': 'Unable to start implementation. Please try again later.',
    };
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard; all SubmitToPhase2Error code values are mapped in errorMessages @preserve */
    const message = errorMessages[result.error.code] ?? 'Unable to start implementation.';
    /* v8 ignore stop @preserve */

    logger.warn(
      { taskId, errorCode: result.error.code, errorMessage: result.error.message },
      'Failed to proceed to implementation'
    );

    const errorNotifyResult = await whatsappPublisher.publishSendMessage({
      userId,
      message,
      correlationId: `proceed-implementation-error-${taskId}`,
    });
    if (!errorNotifyResult.ok) {
      logger.warn({ taskId, error: errorNotifyResult.error.message }, 'Failed to send error notification to user');
    }

    return ok({
      matched: true,
      outcome: 'rejected',
    });
  }

  logger.info({ taskId, phase2TaskId: result.value.codeTaskId }, 'Phase 2 started successfully via button'); // @allow-result-access -- .ok narrowed at line 30

  const successNotifyResult = await whatsappPublisher.publishSendMessage({
    userId,
    message: `🚀 Starting implementation for your task!\n\nYou'll receive another message when it's complete.`,
    correlationId: `proceed-implementation-success-${taskId}`,
  });
  if (!successNotifyResult.ok) {
    logger.warn({ taskId, error: successNotifyResult.error.message }, 'Failed to send success notification to user');
  }

  return ok({
    matched: true,
    outcome: 'approved',
  });
}
