import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { ActionServiceClient } from '../domain/ports/actionServiceClient.js';
import type { ResearchServiceClient } from '../domain/ports/researchServiceClient.js';
import type { NotificationSender } from '../domain/ports/notificationSender.js';
import type { ActionRepository, ListByUserIdOptions } from '../domain/ports/actionRepository.js';
import type { ActionTransitionRepository } from '../domain/ports/actionTransitionRepository.js';
import type {
  CommandsRouterClient,
  CommandWithText,
} from '../domain/ports/commandsRouterClient.js';
import type {
  TodosServiceClient,
  CreateTodoRequest,
  CreateTodoResponse,
} from '../domain/ports/todosServiceClient.js';
import type {
  NotesServiceClient,
  CreateNoteRequest,
  CreateNoteResponse,
} from '../domain/ports/notesServiceClient.js';
import type {
  BookmarksServiceClient,
  CreateBookmarkRequest,
  CreateBookmarkResponse,
} from '../domain/ports/bookmarksServiceClient.js';
import type { Action } from '../domain/models/action.js';
import type { ActionTransition } from '../domain/models/actionTransition.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import type { ResearchModel } from '@intexuraos/llm-contract';
import {
  createHandleResearchActionUseCase,
  type HandleResearchActionUseCase,
} from '../domain/usecases/handleResearchAction.js';
import {
  createChangeActionTypeUseCase,
  type ChangeActionTypeUseCase,
} from '../domain/usecases/changeActionType.js';
import type { Services } from '../services.js';
import type { PublishError, WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionEventPublisher } from '../infra/pubsub/index.js';
import pino from 'pino';

export class FakeActionServiceClient implements ActionServiceClient {
  private actions = new Map<string, Action>();
  private statusUpdates = new Map<string, string>();
  private actionUpdates = new Map<string, { status: string; payload?: Record<string, unknown> }>();
  private failNext = false;
  private failError: Error | null = null;
  private failOn: 'getAction' | 'updateActionStatus' | 'updateAction' | null = null;

  setAction(action: Action): void {
    this.actions.set(action.id, action);
  }

  getStatusUpdates(): Map<string, string> {
    return this.statusUpdates;
  }

  getActionUpdates(): Map<string, { status: string; payload?: Record<string, unknown> }> {
    return this.actionUpdates;
  }

  setFailNext(fail: boolean, error?: Error): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  setFailOn(operation: 'getAction' | 'updateActionStatus' | 'updateAction' | null, error?: Error): void {
    this.failOn = operation;
    this.failError = error ?? null;
  }

  async getAction(actionId: string): Promise<Result<Action | null>> {
    if (this.failNext || this.failOn === 'getAction') {
      this.failNext = false;
      return err(this.failError ?? new Error('Simulated failure'));
    }
    const action = this.actions.get(actionId) ?? null;
    return ok(action);
  }

  async updateActionStatus(actionId: string, status: string): Promise<Result<void>> {
    if (this.failNext || this.failOn === 'updateActionStatus') {
      this.failNext = false;
      return err(this.failError ?? new Error('Simulated failure'));
    }
    this.statusUpdates.set(actionId, status);
    return ok(undefined);
  }

  async updateAction(
    actionId: string,
    update: { status: string; payload?: Record<string, unknown> }
  ): Promise<Result<void>> {
    if (this.failNext || this.failOn === 'updateAction') {
      this.failNext = false;
      return err(this.failError ?? new Error('Simulated failure'));
    }
    this.actionUpdates.set(actionId, update);
    return ok(undefined);
  }
}

export class FakeResearchServiceClient implements ResearchServiceClient {
  private lastCreateDraftParams: {
    userId: string;
    title: string;
    prompt: string;
    selectedModels: ResearchModel[];
    sourceActionId?: string;
  } | null = null;
  private nextResearchId = 'research-123';
  private failNext = false;
  private failError: Error | null = null;

  getLastCreateDraftParams(): typeof this.lastCreateDraftParams {
    return this.lastCreateDraftParams;
  }

  setNextResearchId(id: string): void {
    this.nextResearchId = id;
  }

  setFailNext(fail: boolean, error?: Error): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async createDraft(params: {
    userId: string;
    title: string;
    prompt: string;
    selectedModels: ResearchModel[];
    sourceActionId?: string;
  }): Promise<Result<{ id: string }>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? new Error('Simulated failure'));
    }
    this.lastCreateDraftParams = params;
    return ok({ id: this.nextResearchId });
  }
}

export class FakeNotificationSender implements NotificationSender {
  private notifications: {
    userId: string;
    researchId: string;
    title: string;
    draftUrl: string;
  }[] = [];
  private failNext = false;
  private failError: Error | null = null;

  getNotifications(): typeof this.notifications {
    return this.notifications;
  }

  setFailNext(fail: boolean, error?: Error): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async sendDraftReady(
    userId: string,
    researchId: string,
    title: string,
    draftUrl: string
  ): Promise<Result<void>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? new Error('Simulated failure'));
    }
    this.notifications.push({ userId, researchId, title, draftUrl });
    return ok(undefined);
  }
}

export class FakeActionRepository implements ActionRepository {
  private actions = new Map<string, Action>();
  private failNext = false;
  private failError: Error | null = null;

  getActions(): Map<string, Action> {
    return this.actions;
  }

  setFailNext(fail: boolean, error?: Error): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async getById(id: string): Promise<Action | null> {
    if (this.failNext) {
      this.failNext = false;
      throw this.failError ?? new Error('Simulated failure');
    }
    return this.actions.get(id) ?? null;
  }

  async save(action: Action): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw this.failError ?? new Error('Simulated failure');
    }
    this.actions.set(action.id, action);
  }

  async update(action: Action): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw this.failError ?? new Error('Simulated failure');
    }
    this.actions.set(action.id, action);
  }

  async delete(id: string): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw this.failError ?? new Error('Simulated failure');
    }
    this.actions.delete(id);
  }

  async listByUserId(userId: string, options?: ListByUserIdOptions): Promise<Action[]> {
    if (this.failNext) {
      this.failNext = false;
      throw this.failError ?? new Error('Simulated failure');
    }
    let actions = Array.from(this.actions.values()).filter((a) => a.userId === userId);
    if (options?.status !== undefined && options.status.length > 0) {
      actions = actions.filter((a) => options.status?.includes(a.status));
    }
    return actions;
  }

  async listByStatus(status: Action['status'], limit = 100): Promise<Action[]> {
    if (this.failNext) {
      this.failNext = false;
      throw this.failError ?? new Error('Simulated failure');
    }
    return Array.from(this.actions.values())
      .filter((a) => a.status === status)
      .slice(0, limit);
  }
}

export class FakeActionEventPublisher implements ActionEventPublisher {
  private publishedEvents: ActionCreatedEvent[] = [];
  private failNext = false;
  private failError: PublishError | null = null;

  getPublishedEvents(): ActionCreatedEvent[] {
    return this.publishedEvents;
  }

  setFailNext(fail: boolean, error?: PublishError): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async publishActionCreated(event: ActionCreatedEvent): Promise<Result<void, PublishError>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? { code: 'PUBLISH_FAILED', message: 'Simulated failure' });
    }
    this.publishedEvents.push(event);
    return ok(undefined);
  }
}

export class FakeWhatsAppSendPublisher implements WhatsAppSendPublisher {
  private sentMessages: {
    userId: string;
    message: string;
    correlationId: string;
  }[] = [];
  private failNext = false;
  private failError: PublishError | null = null;

  getSentMessages(): typeof this.sentMessages {
    return this.sentMessages;
  }

  setFailNext(fail: boolean, error?: PublishError): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async publishSendMessage(params: {
    userId: string;
    message: string;
    replyToMessageId?: string;
    correlationId?: string;
  }): Promise<Result<void, PublishError>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? { code: 'PUBLISH_FAILED', message: 'Simulated failure' });
    }
    this.sentMessages.push({
      userId: params.userId,
      message: params.message,
      correlationId: params.correlationId ?? '',
    });
    return ok(undefined);
  }
}

export class FakeActionTransitionRepository implements ActionTransitionRepository {
  private transitions: ActionTransition[] = [];
  private failNext = false;
  private failError: Error | null = null;

  getTransitions(): ActionTransition[] {
    return this.transitions;
  }

  setFailNext(fail: boolean, error?: Error): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async save(transition: ActionTransition): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw this.failError ?? new Error('Simulated failure');
    }
    this.transitions.push(transition);
  }

  async listByUserId(userId: string): Promise<ActionTransition[]> {
    if (this.failNext) {
      this.failNext = false;
      throw this.failError ?? new Error('Simulated failure');
    }
    return this.transitions.filter((t) => t.userId === userId);
  }
}

export class FakeCommandsRouterClient implements CommandsRouterClient {
  private commands = new Map<string, CommandWithText>();
  private failNext = false;
  private failError: Error | null = null;

  setCommand(id: string, text: string, sourceType = 'whatsapp_text'): void {
    this.commands.set(id, { id, text, sourceType });
  }

  setFailNext(fail: boolean, error?: Error): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async getCommand(commandId: string): Promise<CommandWithText | null> {
    if (this.failNext) {
      this.failNext = false;
      throw this.failError ?? new Error('Simulated failure');
    }
    return this.commands.get(commandId) ?? null;
  }
}

export class FakeTodosServiceClient implements TodosServiceClient {
  private createdTodos: CreateTodoRequest[] = [];
  private nextTodoId = 'todo-123';
  private failNext = false;
  private failError: Error | null = null;

  getCreatedTodos(): CreateTodoRequest[] {
    return this.createdTodos;
  }

  setNextTodoId(id: string): void {
    this.nextTodoId = id;
  }

  setFailNext(fail: boolean, error?: Error): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async createTodo(request: CreateTodoRequest): Promise<Result<CreateTodoResponse>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? new Error('Simulated failure'));
    }
    this.createdTodos.push(request);
    return ok({
      id: this.nextTodoId,
      userId: request.userId,
      title: request.title,
      status: 'pending',
    });
  }
}

export class FakeNotesServiceClient implements NotesServiceClient {
  private createdNotes: CreateNoteRequest[] = [];
  private nextNoteId = 'note-123';
  private failNext = false;
  private failError: Error | null = null;

  getCreatedNotes(): CreateNoteRequest[] {
    return this.createdNotes;
  }

  setNextNoteId(id: string): void {
    this.nextNoteId = id;
  }

  setFailNext(fail: boolean, error?: Error): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async createNote(request: CreateNoteRequest): Promise<Result<CreateNoteResponse>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? new Error('Simulated failure'));
    }
    this.createdNotes.push(request);
    return ok({
      id: this.nextNoteId,
      userId: request.userId,
      title: request.title,
    });
  }
}

export class FakeBookmarksServiceClient implements BookmarksServiceClient {
  private createdBookmarks: CreateBookmarkRequest[] = [];
  private nextBookmarkId = 'bookmark-123';
  private failNext = false;
  private failError: Error | null = null;

  getCreatedBookmarks(): CreateBookmarkRequest[] {
    return this.createdBookmarks;
  }

  setNextBookmarkId(id: string): void {
    this.nextBookmarkId = id;
  }

  setFailNext(fail: boolean, error?: Error): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async createBookmark(request: CreateBookmarkRequest): Promise<Result<CreateBookmarkResponse>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? new Error('Simulated failure'));
    }
    this.createdBookmarks.push(request);
    return ok({
      id: this.nextBookmarkId,
      userId: request.userId,
      url: request.url,
      title: request.title ?? null,
    });
  }
}

import type { ExecuteResearchActionResult } from '../domain/usecases/executeResearchAction.js';
import type { ExecuteTodoActionResult } from '../domain/usecases/executeTodoAction.js';
import type { ExecuteNoteActionResult } from '../domain/usecases/executeNoteAction.js';
import type { ExecuteLinkActionResult } from '../domain/usecases/executeLinkAction.js';
import type {
  RetryResult,
  RetryPendingActionsUseCase,
} from '../domain/usecases/retryPendingActions.js';

export type FakeExecuteResearchActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteResearchActionResult, Error>>;

export function createFakeExecuteResearchActionUseCase(config?: {
  failWithError?: Error;
  returnResult?: ExecuteResearchActionResult;
}): FakeExecuteResearchActionUseCase {
  return async (_actionId: string): Promise<Result<ExecuteResearchActionResult, Error>> => {
    if (config?.failWithError !== undefined) {
      return err(config.failWithError);
    }
    return ok(
      config?.returnResult ?? {
        status: 'completed',
        resource_url: '/#/research/test-123',
      }
    );
  };
}

export type FakeExecuteTodoActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteTodoActionResult, Error>>;

export function createFakeExecuteTodoActionUseCase(config?: {
  failWithError?: Error;
  returnResult?: ExecuteTodoActionResult;
}): FakeExecuteTodoActionUseCase {
  return async (_actionId: string): Promise<Result<ExecuteTodoActionResult, Error>> => {
    if (config?.failWithError !== undefined) {
      return err(config.failWithError);
    }
    return ok(
      config?.returnResult ?? {
        status: 'completed',
        resource_url: '/#/todos/todo-123',
      }
    );
  };
}

export type FakeExecuteNoteActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteNoteActionResult, Error>>;

export function createFakeExecuteNoteActionUseCase(config?: {
  failWithError?: Error;
  returnResult?: ExecuteNoteActionResult;
}): FakeExecuteNoteActionUseCase {
  return async (_actionId: string): Promise<Result<ExecuteNoteActionResult, Error>> => {
    if (config?.failWithError !== undefined) {
      return err(config.failWithError);
    }
    return ok(
      config?.returnResult ?? {
        status: 'completed',
        resource_url: '/#/notes/note-123',
      }
    );
  };
}

export type FakeExecuteLinkActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteLinkActionResult, Error>>;

export function createFakeExecuteLinkActionUseCase(config?: {
  failWithError?: Error;
  returnResult?: ExecuteLinkActionResult;
}): FakeExecuteLinkActionUseCase {
  return async (_actionId: string): Promise<Result<ExecuteLinkActionResult, Error>> => {
    if (config?.failWithError !== undefined) {
      return err(config.failWithError);
    }
    return ok(
      config?.returnResult ?? {
        status: 'completed',
        resource_url: '/#/bookmarks/bookmark-123',
      }
    );
  };
}

export function createFakeRetryPendingActionsUseCase(config?: {
  returnResult?: RetryResult;
}): RetryPendingActionsUseCase {
  return {
    async execute(): Promise<RetryResult> {
      return (
        config?.returnResult ?? {
          processed: 0,
          skipped: 0,
          failed: 0,
          total: 0,
          skipReasons: {},
        }
      );
    },
  };
}

import {
  createHandleTodoActionUseCase,
  type HandleTodoActionUseCase,
} from '../domain/usecases/handleTodoAction.js';
import {
  createHandleNoteActionUseCase,
  type HandleNoteActionUseCase,
} from '../domain/usecases/handleNoteAction.js';
import {
  createHandleLinkActionUseCase,
  type HandleLinkActionUseCase,
} from '../domain/usecases/handleLinkAction.js';

export function createFakeServices(deps: {
  actionServiceClient: FakeActionServiceClient;
  researchServiceClient: FakeResearchServiceClient;
  notificationSender: FakeNotificationSender;
  actionRepository?: FakeActionRepository;
  actionTransitionRepository?: FakeActionTransitionRepository;
  commandsRouterClient?: FakeCommandsRouterClient;
  todosServiceClient?: FakeTodosServiceClient;
  notesServiceClient?: FakeNotesServiceClient;
  bookmarksServiceClient?: FakeBookmarksServiceClient;
  actionEventPublisher?: FakeActionEventPublisher;
  whatsappPublisher?: FakeWhatsAppSendPublisher;
  executeResearchActionUseCase?: FakeExecuteResearchActionUseCase;
  executeTodoActionUseCase?: FakeExecuteTodoActionUseCase;
  executeNoteActionUseCase?: FakeExecuteNoteActionUseCase;
  executeLinkActionUseCase?: FakeExecuteLinkActionUseCase;
  retryPendingActionsUseCase?: RetryPendingActionsUseCase;
  changeActionTypeUseCase?: ChangeActionTypeUseCase;
}): Services {
  const whatsappPublisher = deps.whatsappPublisher ?? new FakeWhatsAppSendPublisher();
  const actionRepository = deps.actionRepository ?? new FakeActionRepository();
  const actionTransitionRepository =
    deps.actionTransitionRepository ?? new FakeActionTransitionRepository();
  const commandsRouterClient = deps.commandsRouterClient ?? new FakeCommandsRouterClient();
  const todosServiceClient = deps.todosServiceClient ?? new FakeTodosServiceClient();
  const notesServiceClient = deps.notesServiceClient ?? new FakeNotesServiceClient();
  const bookmarksServiceClient = deps.bookmarksServiceClient ?? new FakeBookmarksServiceClient();

  const silentLogger = pino({ level: 'silent' });

  const handleResearchActionUseCase: HandleResearchActionUseCase =
    createHandleResearchActionUseCase({
      actionServiceClient: deps.actionServiceClient,
      whatsappPublisher,
      webAppUrl: 'http://test.app',
      logger: silentLogger,
    });

  const handleTodoActionUseCase: HandleTodoActionUseCase = createHandleTodoActionUseCase({
    actionServiceClient: deps.actionServiceClient,
    whatsappPublisher,
    webAppUrl: 'http://test.app',
    logger: silentLogger,
  });

  const handleNoteActionUseCase: HandleNoteActionUseCase = createHandleNoteActionUseCase({
    actionServiceClient: deps.actionServiceClient,
    whatsappPublisher,
    webAppUrl: 'http://test.app',
    logger: silentLogger,
  });

  const handleLinkActionUseCase: HandleLinkActionUseCase = createHandleLinkActionUseCase({
    actionServiceClient: deps.actionServiceClient,
    whatsappPublisher,
    webAppUrl: 'http://test.app',
    logger: silentLogger,
  });

  const changeActionTypeUseCase: ChangeActionTypeUseCase =
    deps.changeActionTypeUseCase ??
    createChangeActionTypeUseCase({
      actionRepository,
      actionTransitionRepository,
      commandsRouterClient,
      logger: pino({ level: 'silent' }),
    });

  return {
    actionServiceClient: deps.actionServiceClient,
    researchServiceClient: deps.researchServiceClient,
    notificationSender: deps.notificationSender,
    actionRepository,
    actionTransitionRepository,
    commandsRouterClient,
    todosServiceClient,
    notesServiceClient,
    bookmarksServiceClient,
    actionEventPublisher: deps.actionEventPublisher ?? new FakeActionEventPublisher(),
    whatsappPublisher,
    handleResearchActionUseCase,
    handleTodoActionUseCase,
    handleNoteActionUseCase,
    handleLinkActionUseCase,
    executeResearchActionUseCase:
      deps.executeResearchActionUseCase ?? createFakeExecuteResearchActionUseCase(),
    executeTodoActionUseCase: deps.executeTodoActionUseCase ?? createFakeExecuteTodoActionUseCase(),
    executeNoteActionUseCase: deps.executeNoteActionUseCase ?? createFakeExecuteNoteActionUseCase(),
    executeLinkActionUseCase: deps.executeLinkActionUseCase ?? createFakeExecuteLinkActionUseCase(),
    retryPendingActionsUseCase:
      deps.retryPendingActionsUseCase ?? createFakeRetryPendingActionsUseCase(),
    changeActionTypeUseCase,
    research: handleResearchActionUseCase,
    todo: handleTodoActionUseCase,
    note: handleNoteActionUseCase,
    link: handleLinkActionUseCase,
  };
}
