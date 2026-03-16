/**
 * Execute Linear Action Use Case
 *
 * Handles the execution of Linear issue creation actions.
 * Uses the shared executeActionTemplate for common workflow.
 */

import type { Result } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { Logger } from 'pino';
import {
  createExecuteActionTemplate,
  type ExecuteActionResult,
} from './executeActionTemplate.js';

export interface ExecuteLinearActionDeps {
  actionRepository: ActionRepository;
  linearAgentClient: LinearAgentClient;
  whatsappPublisher: WhatsAppSendPublisher;
  logger: Logger;
}

export type ExecuteLinearActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteActionResult>>;

export function createExecuteLinearActionUseCase(
  deps: ExecuteLinearActionDeps
): ExecuteLinearActionUseCase {
  const { linearAgentClient } = deps;

  return createExecuteActionTemplate(deps, {
    actionType: 'linear',
    validStatuses: ['pending', 'awaiting_approval', 'failed'],
    preparePayload: (action: Action) => {
      const prompt =
        typeof action.payload['prompt'] === 'string' ? action.payload['prompt'] : action.title;
      const summary =
        typeof action.payload['summary'] === 'string' ? action.payload['summary'] : undefined;

      return {
        actionId: action.id,
        userId: action.userId,
        prompt,
        summary,
      };
    },
    callService: async (_action: Action, prepared: Record<string, unknown>) =>
      await linearAgentClient.processAction(
        prepared['actionId'] as string,
        prepared['userId'] as string,
        prepared['prompt'] as string,
        prepared['summary'] as string | undefined
      ),
    buildCompletionMessage: (_action: Action, response) =>
      `🎯 ${response.message} View it here: ${response.resourceUrl ?? ''}`,
    correlationPrefix: 'linear-complete',
  });
}
