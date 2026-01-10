import type { Command, CommandStatus } from '../models/command.js';

export interface CommandRepository {
  getById(id: string): Promise<Command | null>;
  save(command: Command): Promise<void>;
  update(command: Command): Promise<void>;
  delete(id: string): Promise<void>;
  listByUserId(userId: string): Promise<Command[]>;
  listByStatus(status: CommandStatus, limit?: number): Promise<Command[]>;
}
