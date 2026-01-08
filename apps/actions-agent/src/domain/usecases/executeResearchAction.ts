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
  resource_url?: string;
  error?: string;
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
      logger.info({ actionId, resourceUrl }, 'Action already completed, returning existing result');
      return ok({
        status: 'completed' as const,
        ...(resourceUrl !== undefined && { resource_url: resourceUrl }),
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

    logger.info(
      { actionId, userId: action.userId, title: action.title, models: selectedModels },
      'Creating research draft via llm-orchestrator'
    );

    const result = await researchServiceClient.createDraft({
      userId: action.userId,
      title: action.title,
      prompt,
      selectedModels,
      sourceActionId: action.id,
    });

    if (!result.ok) {
      logger.error(
        { actionId, error: getErrorMessage(result.error) },
        'Failed to create research draft via llm-orchestrator'
      );
      const failedAction: Action = {
        ...action,
        status: 'failed',
        payload: {
          ...action.payload,
          error: result.error.message,
        },
        updatedAt: new Date().toISOString(),
      };
      await actionRepository.update(failedAction);
      logger.info({ actionId, status: 'failed' }, 'Action marked as failed');
      return ok({
        status: 'failed',
        error: result.error.message,
      });
    }

    const researchId = result.value.id;
    const resourceUrl = `/#/research/${researchId}`;

    logger.info({ actionId, researchId }, 'Research draft created successfully');

    const completedAction: Action = {
      ...action,
      status: 'completed',
      payload: {
        ...action.payload,
        researchId,
        resource_url: resourceUrl,
      },
      updatedAt: new Date().toISOString(),
    };
    await actionRepository.update(completedAction);

    logger.info({ actionId, researchId, status: 'completed' }, 'Action marked as completed');

    const fullUrl = `${webAppUrl}${resourceUrl}`;
    const message = `Your research draft is ready. Edit it here: ${fullUrl}`;

    logger.info({ actionId, userId: action.userId }, 'Sending WhatsApp completion notification');

    const publishResult = await whatsappPublisher.publishSendMessage({
      userId: action.userId,
      message,
      correlationId: `research-complete-${researchId}`,
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
      { actionId, researchId, resourceUrl, status: 'completed' },
      'Research action execution completed successfully'
    );

    return ok({
      status: 'completed',
      resource_url: resourceUrl,
    });
  };
}
