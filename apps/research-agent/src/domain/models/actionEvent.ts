export type LlmProvider = 'google' | 'openai' | 'anthropic';

export interface ActionCreatedEvent {
  type: 'action.created';
  actionId: string;
  userId: string;
  commandId: string;
  actionType: string;
  title: string;
  payload: {
    prompt: string;
    confidence: number;
    selectedLlms?: LlmProvider[];
  };
  timestamp: string;
}
