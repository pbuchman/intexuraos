export type CommandSourceType = 'whatsapp_text' | 'whatsapp_voice' | 'pwa-shared';
export type CommandStatus =
  | 'received'
  | 'classified'
  | 'pending_classification'
  | 'failed'
  | 'archived';
export type CommandType =
  | 'todo'
  | 'research'
  | 'note'
  | 'link'
  | 'calendar'
  | 'reminder'
  | 'linear';

export interface CommandClassification {
  type: CommandType;
  confidence: number;
  reasoning: string;
  classifiedAt: string;
}

export interface Command {
  id: string;
  userId: string;
  sourceType: CommandSourceType;
  externalId: string;
  text: string;
  summary?: string;
  timestamp: string;
  status: CommandStatus;
  classification?: CommandClassification;
  actionId?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export function createCommandId(sourceType: CommandSourceType, externalId: string): string {
  return `${sourceType}:${externalId}`;
}

export function createCommand(params: {
  userId: string;
  sourceType: CommandSourceType;
  externalId: string;
  text: string;
  summary?: string;
  timestamp: string;
}): Command {
  const now = new Date().toISOString();
  return {
    id: createCommandId(params.sourceType, params.externalId),
    userId: params.userId,
    sourceType: params.sourceType,
    externalId: params.externalId,
    text: params.text,
    ...(params.summary !== undefined && { summary: params.summary }),
    timestamp: params.timestamp,
    status: 'received',
    createdAt: now,
    updatedAt: now,
  };
}
