import type { Logger, ErrorCode, Result } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { ChangeActionTypeUseCase } from './changeActionType.js';
import type { Action, ActionType } from '../models/action.js';

export interface UpdateActionParams {
  actionId: string;
  userId: string;
  status?: 'processing' | 'rejected' | 'archived' | undefined;
  type?: ActionType | undefined;
}

export interface UpdateActionDeps {
  actionRepository: ActionRepository;
  changeActionTypeUseCase: ChangeActionTypeUseCase;
  logger: Logger;
}

export type UpdateActionUseCase = (
  params: UpdateActionParams
) => Promise<Result<{ action: Action }, { code: ErrorCode; message: string }>>;

export function createUpdateActionUseCase(deps: UpdateActionDeps): UpdateActionUseCase {
  return async (params) => {
    const { actionId, userId, status, type } = params;
    const { actionRepository, changeActionTypeUseCase, logger } = deps;

    // 1. Fetch action and verify ownership
    const action = await actionRepository.getById(actionId);
    if (action?.userId !== userId) {
      logger.error({ actionId, userId, reason: 'not_found' }, 'Action not found for update');
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Action not found' } };
    }

    // 2. Handle type change if requested (changeActionTypeUseCase handles its own persistence)
    if (type !== undefined && type !== action.type) {
      const result = await changeActionTypeUseCase({ actionId, userId, newType: type });
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      // Update local reference for the response object only
      action.type = type;
    }

    // 3. Handle status change if requested
    if (status !== undefined) {
      action.status = status;
      action.updatedAt = new Date().toISOString();
      await actionRepository.update(action);
    }

    return { ok: true, value: { action } };
  };
}
