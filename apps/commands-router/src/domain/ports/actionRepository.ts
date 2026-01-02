import type { Action } from '../models/action.js';

export interface ActionRepository {
  getById(id: string): Promise<Action | null>;
  save(action: Action): Promise<void>;
  update(action: Action): Promise<void>;
  delete(id: string): Promise<void>;
  listByUserId(userId: string): Promise<Action[]>;
}
