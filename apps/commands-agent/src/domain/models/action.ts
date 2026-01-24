export type ActionType = 'todo' | 'research' | 'note' | 'link' | 'calendar' | 'reminder' | 'linear' | 'code';
export type ActionStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'archived';

export interface Action {
  id: string;
  userId: string;
  commandId: string;
  type: ActionType;
  confidence: number;
  title: string;
  status: ActionStatus;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function createAction(params: {
  userId: string;
  commandId: string;
  type: ActionType;
  confidence: number;
  title: string;
}): Action {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    userId: params.userId,
    commandId: params.commandId,
    type: params.type,
    confidence: params.confidence,
    title: params.title,
    status: 'pending',
    payload: {},
    createdAt: now,
    updatedAt: now,
  };
}
