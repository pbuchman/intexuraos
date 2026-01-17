import type { Action, ActionStatus } from '../models/action.js';

export interface ListByUserIdOptions {
  status?: ActionStatus[] | undefined;
}

/**
 * Result of conditional status update.
 * Discriminated union allows callers to handle each case appropriately.
 */
export type UpdateStatusIfResult =
  | { outcome: 'updated' }
  | { outcome: 'status_mismatch'; currentStatus: string }
  | { outcome: 'not_found' }
  | { outcome: 'error'; error: Error };

export interface ActionRepository {
  getById(id: string): Promise<Action | null>;
  save(action: Action): Promise<void>;
  update(action: Action): Promise<void>;
  delete(id: string): Promise<void>;
  listByUserId(userId: string, options?: ListByUserIdOptions): Promise<Action[]>;
  listByStatus(status: ActionStatus, limit?: number): Promise<Action[]>;

  /**
   * Atomically update action status only if current status matches one of the expectedStatuses.
   * Returns discriminated union with outcome to allow proper error handling.
   * Used to prevent race conditions in PubSub message handlers.
   */
  updateStatusIf(
    actionId: string,
    newStatus: ActionStatus,
    expectedStatuses: ActionStatus | ActionStatus[]
  ): Promise<UpdateStatusIfResult>;
}
