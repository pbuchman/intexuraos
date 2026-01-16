import type { Result } from '@intexuraos/common-core';
import type { Action, ActionType } from '../models/action.js';

export interface CreateActionParams {
  userId: string;
  commandId: string;
  type: ActionType;
  title: string;
  confidence: number;
  payload?: Record<string, unknown>;
}

export interface ActionsAgentClient {
  createAction(params: CreateActionParams): Promise<Result<Action>>;
}
