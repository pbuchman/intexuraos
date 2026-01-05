import type { ActionTransition } from '../models/actionTransition.js';

export interface ActionTransitionRepository {
  save(transition: ActionTransition): Promise<void>;
  listByUserId(userId: string): Promise<ActionTransition[]>;
}
