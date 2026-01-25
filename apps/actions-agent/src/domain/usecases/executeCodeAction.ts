/**
 * Execute Code Action Use Case
 *
 * Handles the execution of code actions by:
 * 1. Retrieving the action from the repository
 * 2. Generating approvalEventId for idempotency (design lines 1532-1536)
 * 3. Calling code-agent to process the action
 * 4. Updating action status and storing resource_url (design lines 1471-1474)
 * 5. Sending WhatsApp notification on completion
 *
 * Based on design doc: docs/designs/INT-156-code-action-type.md
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { CodeAgentClient } from '../ports/codeAgentClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { Logger } from 'pino';
import { randomUUID } from 'crypto';

export interface ExecuteCodeActionDeps {
  actionRepository: ActionRepository;
  codeAgentClient: CodeAgentClient;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
}

export interface ExecuteCodeActionResult {
  status: 'completed' | 'failed';
  message?: string;
  resourceUrl?: string;
  errorCode?: string;
}

export type ExecuteCodeActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteCodeActionResult>>;

export function createExecuteCodeActionUseCase(
  deps: ExecuteCodeActionDeps
): ExecuteCodeActionUseCase {
  const { actionRepository, codeAgentClient, whatsappPublisher, webAppUrl, logger } = deps;

  return async (actionId: string): Promise<Result<ExecuteCodeActionResult>> => {
    logger.info({ actionId }, 'Executing code action');

    const action = await actionRepository.getById(actionId);
    if (action === null) {
      logger.error({ actionId }, 'Action not found');
      return err(new Error('Action not found'));
    }

    logger.info(
      { actionId, userId: action.userId, status: action.status, title: action.title },
      'Retrieved action for execution'
    );

    if (action.status === 'completed') {
      const resourceUrl = action.payload['resource_url'] as string | undefined;
      const message = action.payload['message'] as string | undefined;
      logger.info({ actionId, resourceUrl }, 'Action already completed, returning existing result');
      return ok({
        status: 'completed' as const,
        ...(message !== undefined && { message }),
        ...(resourceUrl !== undefined && { resourceUrl }),
      });
    }

    const validStatuses = ['pending', 'awaiting_approval', 'failed'];
    if (!validStatuses.includes(action.status)) {
      logger.error(
        { actionId, status: action.status },
        'Cannot execute action with invalid status'
      );
      return err(new Error(`Cannot execute action with status: ${action.status}`));
    }

    logger.info({ actionId }, 'Setting action to processing');
    const updatedAction: Action = {
      ...action,
      status: 'processing',
      updatedAt: new Date().toISOString(),
    };
    await actionRepository.update(updatedAction);

    // Design lines 1532-1536: Generate approvalEventId for idempotency
    // This prevents WhatsApp retries or duplicate approval messages from spawning multiple tasks
    const approvalEventId = randomUUID();

    // Get payload fields
    const prompt = typeof action.payload['prompt'] === 'string' ? action.payload['prompt'] : action.title;
    const workerTypeRaw = action.payload['workerType'] as 'opus' | 'auto' | 'glm' | undefined;
    const workerType = workerTypeRaw ?? 'auto';
    const linearIssueId = action.payload['linearIssueId'] as string | undefined;
    const linearIssueTitle = action.payload['linearIssueTitle'] as string | undefined;

    logger.info(
      { actionId, userId: action.userId, prompt: prompt.substring(0, 50), workerType },
      'Processing code action via code-agent'
    );

    // Build payload without undefined values (exactOptionalPropertyTypes)
    const payload: {
      prompt: string;
      workerType: 'opus' | 'auto' | 'glm';
      linearIssueId?: string;
      linearIssueTitle?: string;
    } = { prompt, workerType };
    if (linearIssueId !== undefined) {
      payload.linearIssueId = linearIssueId;
    }
    if (linearIssueTitle !== undefined) {
      payload.linearIssueTitle = linearIssueTitle;
    }

    const result = await codeAgentClient.submitTask({
      actionId,
      approvalEventId,
      payload,
    });

    if (!result.ok) {
      logger.error(
        { actionId, error: getErrorMessage(result.error) },
        'Failed to process code action via code-agent'
      );

      // Handle specific error codes
      if (result.error.code === 'WORKER_UNAVAILABLE') {
        const failedAction: Action = {
          ...action,
          status: 'failed',
          payload: {
            ...action.payload,
            message: 'No workers available. Please try again later.',
          },
          updatedAt: new Date().toISOString(),
        };
        await actionRepository.update(failedAction);
        logger.info({ actionId, status: 'failed' }, 'Action marked as failed (worker unavailable)');
        return ok({
          status: 'failed',
          message: 'No workers available. Please try again later.',
        });
      }

      if (result.error.code === 'DUPLICATE') {
        logger.info({ actionId, existingTaskId: result.error.existingTaskId }, 'Duplicate task detected');
        // Return success with existing task info - idempotent operation
        const taskIdMessage = result.error.existingTaskId !== undefined
          ? `Task already exists: ${result.error.existingTaskId}`
          : 'Task already exists';
        return ok({
          status: 'completed' as const,
          message: taskIdMessage,
        });
      }

      const failedAction: Action = {
        ...action,
        status: 'failed',
        payload: {
          ...action.payload,
          message: result.error.message,
        },
        updatedAt: new Date().toISOString(),
      };
      await actionRepository.update(failedAction);
      logger.info({ actionId, status: 'failed' }, 'Action marked as failed');
      return ok({
        status: 'failed',
        message: result.error.message,
      });
    }

    const { codeTaskId, resourceUrl } = result.value;
    logger.info({ actionId, codeTaskId, resourceUrl }, 'Code task created successfully');

    // Design lines 1471-1474: Store resource_url and approvalEventId in action payload
    const completedAction: Action = {
      ...action,
      status: 'completed',
      payload: {
        ...action.payload,
        resource_url: resourceUrl,
        message: `Code task ${codeTaskId} created successfully`,
        approvalEventId,
      },
      updatedAt: new Date().toISOString(),
    };
    await actionRepository.update(completedAction);

    logger.info({ actionId, status: 'completed' }, 'Action marked as completed');

    const fullUrl = `${webAppUrl}${resourceUrl}`;
    const whatsappMessage = `Code task created! View it here: ${fullUrl}`;

    logger.info({ actionId, userId: action.userId }, 'Sending WhatsApp completion notification');

    const publishResult = await whatsappPublisher.publishSendMessage({
      userId: action.userId,
      message: whatsappMessage,
      correlationId: `code-complete-${actionId}`,
    });

    if (!publishResult.ok) {
      logger.warn(
        { actionId, userId: action.userId, error: publishResult.error.message },
        'Failed to send WhatsApp notification (non-fatal)'
      );
    } else {
      logger.info({ actionId }, 'WhatsApp completion notification sent');
    }

    logger.info(
      { actionId, codeTaskId, resourceUrl, status: 'completed' },
      'Code action execution completed successfully'
    );

    return ok({
      status: 'completed',
      message: `Code task ${codeTaskId} created successfully`,
      resourceUrl,
    });
  };
}
