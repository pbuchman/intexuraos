import type { Action, ActionStatus } from '../models/action.js';

export interface ListByUserIdOptions {
  status?: ActionStatus[] | undefined;
}

export interface ActionRepository {
  getById(id: string): Promise<Action | null>;
  save(action: Action): Promise<void>;
  update(action: Action): Promise<void>;
  delete(id: string): Promise<void>;
  listByUserId(userId: string, options?: ListByUserIdOptions): Promise<Action[]>;
  listByStatus(status: ActionStatus, limit?: number): Promise<Action[]>;

  /**
   * Atomically update action status only if current status matches expectedStatus.
   * Returns true if update was applied, false if status didn't match (concurrent modification).
   * Used to prevent race conditions in PubSub message handlers.
   */
  updateStatusIf(
    actionId: string,
    newStatus: ActionStatus,
    expectedStatus: ActionStatus
  ): Promise<boolean>;
}
