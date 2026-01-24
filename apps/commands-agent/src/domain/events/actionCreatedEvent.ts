import type { ActionType } from '../models/action.js';

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
    summary?: string;
  };
  timestamp: string;
}
