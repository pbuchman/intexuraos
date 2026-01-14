import type { Result } from '@intexuraos/common-core';
import type { ActionCreatedEvent } from '../models/actionEvent.js';
import type { HandleResearchActionUseCase } from './handleResearchAction.js';
import type { HandleTodoActionUseCase } from './handleTodoAction.js';
import type { HandleNoteActionUseCase } from './handleNoteAction.js';
import type { HandleLinkActionUseCase } from './handleLinkAction.js';
import type { HandleCalendarActionUseCase } from './handleCalendarAction.js';

export interface ActionHandler {
  execute(event: ActionCreatedEvent): Promise<Result<{ actionId: string }>>;
}

export interface ActionHandlerRegistry {
  research: HandleResearchActionUseCase;
  todo: HandleTodoActionUseCase;
  note: HandleNoteActionUseCase;
  link: HandleLinkActionUseCase;
  calendar: HandleCalendarActionUseCase;
}

export function getHandlerForType(
  registry: ActionHandlerRegistry,
  actionType: string
): ActionHandler | undefined {
  const handler = registry[actionType as keyof ActionHandlerRegistry];
  return handler;
}
