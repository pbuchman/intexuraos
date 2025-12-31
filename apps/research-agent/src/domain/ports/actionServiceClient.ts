import type { Result } from '@intexuraos/common-core';

export interface ActionServiceClient {
  updateActionStatus(actionId: string, status: string): Promise<Result<void>>;
  updateAction(
    actionId: string,
    update: { status: string; payload?: Record<string, unknown> }
  ): Promise<Result<void>>;
}
