import type { Command } from '../models/command.js';

export interface CommandRepository {
  getById(id: string): Promise<Command | null>;
  save(command: Command): Promise<void>;
  update(command: Command): Promise<void>;
  listByUserId(userId: string): Promise<Command[]>;
}
