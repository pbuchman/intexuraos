import type { CommandSourceType } from '../models/command.js';

export interface CommandEvent {
  type: 'command.ingest';
  userId: string;
  sourceType: CommandSourceType;
  externalId: string;
  text: string;
  summary?: string;
  timestamp: string;
}
