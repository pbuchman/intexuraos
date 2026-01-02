import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { ResearchServiceClient } from '../ports/researchServiceClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { LlmProvider } from '../models/actionEvent.js';

export interface ExecuteResearchActionDeps {
  actionRepository: ActionRepository;
  researchServiceClient: ResearchServiceClient;
  whatsappPublisher: WhatsAppSendPublisher;
  webAppUrl: string;
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
  return async (actionId: string): Promise<Result<ExecuteResearchActionResult>> => {
    const { actionRepository, researchServiceClient, whatsappPublisher, webAppUrl } = deps;

    const action = await actionRepository.getById(actionId);
    if (action === null) {
      return err(new Error('Action not found'));
    }

    if (action.status === 'completed') {
      const resourceUrl = action.payload['resource_url'] as string;
      return ok({
        status: 'completed',
        resource_url: resourceUrl,
      });
    }

    if (action.status !== 'awaiting_approval' && action.status !== 'failed') {
      return err(new Error(`Cannot execute action with status: ${action.status}`));
    }

    const updatedAction: Action = {
      ...action,
      status: 'processing',
      updatedAt: new Date().toISOString(),
    };
    await actionRepository.update(updatedAction);

    const selectedLlms: LlmProvider[] = ['anthropic'];
    const result = await researchServiceClient.createDraft({
      userId: action.userId,
      title: action.title,
      prompt: action.title,
      selectedLlms,
      sourceActionId: action.id,
    });

    if (!result.ok) {
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
      return ok({
        status: 'failed',
        error: result.error.message,
      });
    }

    const researchId = result.value.id;
    const resourceUrl = `/#/research/${researchId}/edit`;

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

    const fullUrl = `${webAppUrl}${resourceUrl}`;
    const message = `Your research draft is ready. Edit it here: ${fullUrl}`;

    const publishResult = await whatsappPublisher.publishSendMessage({
      userId: action.userId,
      message,
      correlationId: `research-complete-${researchId}`,
    });

    if (!publishResult.ok) {
      /* Best-effort notification - don't fail the action if notification fails */
    }

    return ok({
      status: 'completed',
      resource_url: resourceUrl,
    });
  };
}
