import type { ActionType } from './action.js';

export interface ActionTransition {
  id: string;
  userId: string;
  actionId: string;
  commandId: string;
  commandText: string;
  originalType: ActionType;
  newType: ActionType;
  originalConfidence: number;
  createdAt: string;
}

export function createActionTransition(params: {
  userId: string;
  actionId: string;
  commandId: string;
  commandText: string;
  originalType: ActionType;
  newType: ActionType;
  originalConfidence: number;
}): ActionTransition {
  return {
    id: crypto.randomUUID(),
    ...params,
    createdAt: new Date().toISOString(),
  };
}
