import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import { type ResearchModel } from '@intexuraos/llm-contract';
import type { Action } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { ResearchServiceClient } from '../ports/researchServiceClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { Logger } from 'pino';

export interface ExecuteResearchActionDeps {
  actionRepository: ActionRepository;
  researchServiceClient: ResearchServiceClient;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
  logger: Logger;
}

export interface ExecuteResearchActionResult {
  status: 'completed' | 'failed';
  message?: string;
  resourceUrl?: string;
  errorCode?: string;
}

export type ExecuteResearchActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteResearchActionResult>>;

export function createExecuteResearchActionUseCase(
  deps: ExecuteResearchActionDeps
): ExecuteResearchActionUseCase {
  const { actionRepository, researchServiceClient, whatsappPublisher, webAppUrl, logger } = deps;

  return async (actionId: string): Promise<Result<ExecuteResearchActionResult>> => {
    logger.info({ actionId }, 'Executing research action');

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

    if (action.status !== 'awaiting_approval' && action.status !== 'failed') {
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

    // No default models - user must select before approving the research draft
    const selectedModels: ResearchModel[] = [];
    const prompt =
      typeof action.payload['prompt'] === 'string' ? action.payload['prompt'] : action.title;
    const summary =
      typeof action.payload['summary'] === 'string' ? action.payload['summary'] : undefined;

    const promptWithKeyPoints =
      summary !== undefined ? `## Key Points\n\n${summary}\n\n---\n\n${prompt}` : prompt;

    logger.info(
      { actionId, userId: action.userId, title: action.title, models: selectedModels },
      'Creating research draft via research-agent'
    );

    const result = await researchServiceClient.createDraft({
      userId: action.userId,
      title: action.title,
      prompt: promptWithKeyPoints,
      selectedModels,
      sourceActionId: action.id,
    });

    if (!result.ok) {
      logger.error(
        { actionId, error: getErrorMessage(result.error) },
        'Failed to create research draft via research-agent'
      );
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

    const response = result.value;

    if (response.status === 'failed') {
      const errorMessage = response.message;
      logger.info({ actionId, message: errorMessage }, 'Research action failed');
      const failedAction: Action = {
        ...action,
        status: 'failed',
        payload: {
          ...action.payload,
          message: errorMessage,
          ...(response.errorCode !== undefined && { errorCode: response.errorCode }),
        },
        updatedAt: new Date().toISOString(),
      };
      await actionRepository.update(failedAction);
      return ok({
        status: 'failed',
        message: errorMessage,
        ...(response.errorCode !== undefined && { errorCode: response.errorCode }),
      });
    }

    const { resourceUrl, message } = response;
    logger.info({ actionId, resourceUrl }, 'Research draft created successfully');

    const completedAction: Action = {
      ...action,
      status: 'completed',
      payload: {
        ...action.payload,
        message,
        ...(resourceUrl !== undefined && { resource_url: resourceUrl }),
      },
      updatedAt: new Date().toISOString(),
    };
    await actionRepository.update(completedAction);

    logger.info({ actionId, status: 'completed' }, 'Action marked as completed');

    if (resourceUrl !== undefined) {
      const fullUrl = `${webAppUrl}${resourceUrl}`;
      const whatsappMessage = `${message} View it here: ${fullUrl}`;

      logger.info({ actionId, userId: action.userId }, 'Sending WhatsApp completion notification');

      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: action.userId,
        message: whatsappMessage,
        correlationId: `research-complete-${actionId}`,
      });

      if (!publishResult.ok) {
        logger.warn(
          { actionId, userId: action.userId, error: publishResult.error.message },
          'Failed to send WhatsApp notification (non-fatal)'
        );
      } else {
        logger.info({ actionId }, 'WhatsApp completion notification sent');
      }
    }

    logger.info(
      { actionId, resourceUrl, status: 'completed' },
      'Research action execution completed successfully'
    );

    return ok({
      status: 'completed',
      message,
      ...(resourceUrl !== undefined && { resourceUrl }),
    });
  };
}
