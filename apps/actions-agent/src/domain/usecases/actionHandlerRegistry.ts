import type { Result } from '@intexuraos/common-core';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { HandleResearchActionUseCase } from './handleResearchAction.js';

export interface ActionHandler {
  execute(event: ActionCreatedEvent): Promise<Result<{ researchId: string }>>;
}

export interface ActionHandlerRegistry {
  research: HandleResearchActionUseCase;
}

export function getHandlerForType(
  registry: ActionHandlerRegistry,
  actionType: string
): ActionHandler | undefined {
  const handler = registry[actionType as keyof ActionHandlerRegistry];
  return handler;
}
