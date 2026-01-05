import type { Logger, ErrorCode } from '@intexuraos/common-core';
import type { Result } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { ActionTransitionRepository } from '../ports/actionTransitionRepository.js';
import type { CommandsRouterClient } from '../ports/commandsRouterClient.js';
import type { ActionType } from '../models/action.js';
import { createActionTransition } from '../models/actionTransition.js';

export interface ChangeActionTypeParams {
  actionId: string;
  userId: string;
  newType: ActionType;
}

export interface ChangeActionTypeDeps {
  actionRepository: ActionRepository;
  actionTransitionRepository: ActionTransitionRepository;
  commandsRouterClient: CommandsRouterClient;
  logger: Logger;
}

export interface ChangeActionTypeError {
  code: ErrorCode;
  message: string;
}

export type ChangeActionTypeUseCase = (
  params: ChangeActionTypeParams
) => Promise<Result<{ actionId: string }, ChangeActionTypeError>>;

export function createChangeActionTypeUseCase(deps: ChangeActionTypeDeps): ChangeActionTypeUseCase {
  return async (params) => {
    const { actionId, userId, newType } = params;
    const { actionRepository, actionTransitionRepository, commandsRouterClient, logger } = deps;

    // 1. Fetch action
    const action = await actionRepository.getById(actionId);
    if (action?.userId !== userId) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Action not found' } };
    }

    // 2. Validate status allows type change
    const allowedStatuses = ['pending', 'awaiting_approval'];
    if (!allowedStatuses.includes(action.status)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: `Cannot change type for action in status: ${action.status}`,
        },
      };
    }

    // 3. Skip if same type
    if (action.type === newType) {
      return { ok: true, value: { actionId } };
    }

    // 4. Fetch command text from commands-router (never trust frontend)
    const command = await commandsRouterClient.getCommand(action.commandId);
    if (command === null) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Command not found' } };
    }

    // 5. Log transition
    const transition = createActionTransition({
      userId,
      actionId,
      commandId: action.commandId,
      commandText: command.text,
      originalType: action.type,
      newType,
      originalConfidence: action.confidence,
    });
    await actionTransitionRepository.save(transition);

    logger.info(
      {
        actionId,
        originalType: action.type,
        newType,
        transitionId: transition.id,
      },
      'Action type changed'
    );

    // 6. Update action type
    action.type = newType;
    action.updatedAt = new Date().toISOString();
    await actionRepository.update(action);

    return { ok: true, value: { actionId } };
  };
}
