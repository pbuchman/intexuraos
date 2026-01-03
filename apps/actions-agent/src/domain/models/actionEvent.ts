import type { ActionType } from './action.js';
import type { SupportedModel } from '@intexuraos/llm-contract';

export interface ActionCreatedEvent {
  type: 'action.created';
  actionId: string;
  userId: string;
  commandId: string;
  actionType: ActionType;
  title: string;
  payload: {
    prompt: string;
    confidence: number;
    selectedModels?: SupportedModel[];
  };
  timestamp: string;
}
