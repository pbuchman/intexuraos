import type { Result } from '@intexuraos/common-core';
import type { Action } from '../models/action.js';

export interface ActionServiceClient {
  getAction(actionId: string): Promise<Result<Action | null>>;
  updateActionStatus(actionId: string, status: string): Promise<Result<void>>;
  updateAction(
    actionId: string,
    update: { status: string; payload?: Record<string, unknown> }
  ): Promise<Result<void>>;
}
