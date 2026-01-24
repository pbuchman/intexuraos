import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import { registerActionHandler } from '../domain/usecases/createIdempotentActionHandler.js';
import type { ActionServiceClient } from '../domain/ports/actionServiceClient.js';
import type {
  CalendarServiceClient,
  ProcessCalendarRequest,
  CalendarPreview,
} from '../domain/ports/calendarServiceClient.js';
import type { ResearchServiceClient } from '../domain/ports/researchServiceClient.js';
import type { NotificationSender } from '../domain/ports/notificationSender.js';
import type {
  ActionRepository,
  ListByUserIdOptions,
  UpdateStatusIfResult,
} from '../domain/ports/actionRepository.js';
import type { ActionTransitionRepository } from '../domain/ports/actionTransitionRepository.js';
import type {
  CommandsAgentClient,
  CommandWithText,
} from '../domain/ports/commandsAgentClient.js';
import type {
  TodosServiceClient,
  CreateTodoRequest,
} from '../domain/ports/todosServiceClient.js';
import type {
  NotesServiceClient,
  CreateNoteRequest,
} from '../domain/ports/notesServiceClient.js';
import type {
  BookmarksServiceClient,
  CreateBookmarkRequest,
  CreateBookmarkResponse,
  CreateBookmarkError,
  ForceRefreshBookmarkResponse,
} from '../domain/ports/bookmarksServiceClient.js';
import type { LinearAgentClient } from '../domain/ports/linearAgentClient.js';
import type { CodeAgentClient } from '../domain/ports/codeAgentClient.js';
import type { Action } from '../domain/models/action.js';
import type { ActionTransition } from '../domain/models/actionTransition.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import {
  createHandleResearchActionUseCase,
  type HandleResearchActionUseCase,
} from '../domain/usecases/handleResearchAction.js';
import {
  createChangeActionTypeUseCase,
  type ChangeActionTypeUseCase,
} from '../domain/usecases/changeActionType.js';
import type {
  HandleApprovalReplyUseCase,
  ApprovalReplyInput,
  ApprovalReplyResult,
} from '../domain/usecases/handleApprovalReply.js';
import type {
  ApprovalMessageRepository,
  ApprovalMessageRepositoryError,
} from '../domain/ports/approvalMessageRepository.js';
import type { ApprovalMessage } from '../domain/models/approvalMessage.js';
import type { UserServiceClient, UserServiceError } from '../infra/user/userServiceClient.js';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { Services } from '../services.js';
import type {
  PublishError,
  WhatsAppSendPublisher,
  CalendarPreviewPublisher,
} from '@intexuraos/infra-pubsub';
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
    originalMessage: string;
    sourceActionId?: string;
  } | null = null;
  private nextResponse: ServiceFeedback = {
    status: 'completed',
    message: 'Research draft created successfully',
    resourceUrl: '/#/research/research-123',
  };
  private failNext = false;
  private failError: Error | null = null;

  getLastCreateDraftParams(): typeof this.lastCreateDraftParams {
    return this.lastCreateDraftParams;
  }

  setNextResponse(response: ServiceFeedback): void {
    this.nextResponse = response;
  }

  setFailNext(fail: boolean, error?: Error): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async createDraft(params: {
    userId: string;
    title: string;
    prompt: string;
    originalMessage: string;
    sourceActionId?: string;
  }): Promise<Result<ServiceFeedback>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? new Error('Simulated failure'));
    }
    this.lastCreateDraftParams = params;
    return ok(this.nextResponse);
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
  private updateStatusIfResults = new Map<string, UpdateStatusIfResult>();

  getActions(): Map<string, Action> {
    return this.actions;
  }

  setUpdateStatusIfResult(actionId: string, result: UpdateStatusIfResult): void {
    this.updateStatusIfResults.set(actionId, result);
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
    // Store a copy to prevent mutation of the original object
    this.actions.set(action.id, { ...action, payload: { ...action.payload } });
  }

  async update(action: Action): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw this.failError ?? new Error('Simulated failure');
    }
    // Store a copy to prevent mutation of the original object
    this.actions.set(action.id, { ...action, payload: { ...action.payload } });
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

  async updateStatusIf(
    actionId: string,
    newStatus: Action['status'],
    expectedStatuses: Action['status'] | Action['status'][]
  ): Promise<UpdateStatusIfResult> {
    if (this.failNext) {
      this.failNext = false;
      return { outcome: 'error', error: this.failError ?? new Error('Simulated failure') };
    }

    if (this.updateStatusIfResults.has(actionId)) {
      const result = this.updateStatusIfResults.get(actionId);
      if (result !== undefined && result.outcome === 'updated') {
        const action = this.actions.get(actionId);
        if (action !== undefined) {
          action.status = newStatus;
          action.updatedAt = new Date().toISOString();
        }
      }
      return result ?? { outcome: 'not_found' };
    }

    const expectedArray = Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses];
    const action = this.actions.get(actionId);
    if (action === undefined) {
      return { outcome: 'not_found' };
    }
    if (!expectedArray.includes(action.status)) {
      return { outcome: 'status_mismatch', currentStatus: action.status };
    }
    action.status = newStatus;
    action.updatedAt = new Date().toISOString();
    return { outcome: 'updated' };
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

export class FakeCalendarPreviewPublisher implements CalendarPreviewPublisher {
  private publishedRequests: {
    actionId: string;
    userId: string;
    text: string;
    currentDate: string;
    correlationId: string;
  }[] = [];
  private failNext = false;
  private failError: PublishError | null = null;

  getPublishedRequests(): typeof this.publishedRequests {
    return this.publishedRequests;
  }

  setFailNext(fail: boolean, error?: PublishError): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async publishGeneratePreview(params: {
    actionId: string;
    userId: string;
    text: string;
    currentDate: string;
    correlationId?: string;
  }): Promise<Result<void, PublishError>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? { code: 'PUBLISH_FAILED', message: 'Simulated failure' });
    }
    this.publishedRequests.push({
      actionId: params.actionId,
      userId: params.userId,
      text: params.text,
      currentDate: params.currentDate,
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

export class FakeCommandsAgentClient implements CommandsAgentClient {
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
  private nextResponse: ServiceFeedback = {
    status: 'completed',
    message: 'Todo created successfully',
    resourceUrl: '/#/todos/todo-123',
  };
  private failNext = false;
  private failError: Error | null = null;

  getCreatedTodos(): CreateTodoRequest[] {
    return this.createdTodos;
  }

  setNextResponse(response: ServiceFeedback): void {
    this.nextResponse = response;
  }

  setFailNext(fail: boolean, error?: Error): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async createTodo(request: CreateTodoRequest): Promise<Result<ServiceFeedback>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? new Error('Simulated failure'));
    }
    this.createdTodos.push(request);
    return ok(this.nextResponse);
  }
}

export class FakeNotesServiceClient implements NotesServiceClient {
  private createdNotes: CreateNoteRequest[] = [];
  private nextResponse: ServiceFeedback = {
    status: 'completed',
    message: 'Note created successfully',
    resourceUrl: '/#/notes/note-123',
  };
  private failNext = false;
  private failError: Error | null = null;

  getCreatedNotes(): CreateNoteRequest[] {
    return this.createdNotes;
  }

  setNextResponse(response: ServiceFeedback): void {
    this.nextResponse = response;
  }

  setFailNext(fail: boolean, error?: Error): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async createNote(request: CreateNoteRequest): Promise<Result<ServiceFeedback>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? new Error('Simulated failure'));
    }
    this.createdNotes.push(request);
    return ok(this.nextResponse);
  }
}

export class FakeBookmarksServiceClient implements BookmarksServiceClient {
  private createdBookmarks: CreateBookmarkRequest[] = [];
  private nextBookmarkId = 'bookmark-123';
  private failNext = false;
  private failError: CreateBookmarkError | null = null;

  getCreatedBookmarks(): CreateBookmarkRequest[] {
    return this.createdBookmarks;
  }

  setNextBookmarkId(id: string): void {
    this.nextBookmarkId = id;
  }

  setFailNext(fail: boolean, error?: CreateBookmarkError): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async createBookmark(
    request: CreateBookmarkRequest
  ): Promise<Result<CreateBookmarkResponse, CreateBookmarkError>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? { message: 'Simulated failure' });
    }
    this.createdBookmarks.push(request);
    return ok({
      id: this.nextBookmarkId,
      userId: request.userId,
      url: request.url,
      title: request.title ?? null,
    });
  }

  async forceRefreshBookmark(
    _bookmarkId: string
  ): Promise<Result<ForceRefreshBookmarkResponse>> {
    if (this.failNext) {
      this.failNext = false;
      const message = this.failError?.message ?? 'Simulated failure';
      return err(new Error(message));
    }
    return ok({
      id: _bookmarkId,
      url: 'https://example.com',
      status: 'active',
      ogPreview: null,
      ogFetchStatus: 'processed',
    });
  }
}

export class FakeCalendarServiceClient implements CalendarServiceClient {
  private processedActions: ProcessCalendarRequest[] = [];
  private previews = new Map<string, CalendarPreview>();
  private nextResponse: ServiceFeedback = {
    status: 'completed',
    message: 'Calendar event created successfully',
    resourceUrl: '/#/calendar',
  };
  private failNext = false;
  private failError: Error | null = null;

  getProcessedActions(): ProcessCalendarRequest[] {
    return this.processedActions;
  }

  setNextResponse(response: ServiceFeedback): void {
    this.nextResponse = response;
  }

  setFailNext(fail: boolean, error?: Error): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  setPreview(actionId: string, preview: CalendarPreview): void {
    this.previews.set(actionId, preview);
  }

  async processAction(request: ProcessCalendarRequest): Promise<Result<ServiceFeedback>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? new Error('Simulated failure'));
    }
    this.processedActions.push(request);
    return ok(this.nextResponse);
  }

  async getPreview(actionId: string): Promise<Result<CalendarPreview | null>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? new Error('Simulated failure'));
    }
    return ok(this.previews.get(actionId) ?? null);
  }
}

export class FakeLinearAgentClient implements LinearAgentClient {
  private processedActions: {
    actionId: string;
    userId: string;
    text: string;
    summary?: string;
  }[] = [];
  private nextResponse: ServiceFeedback = {
    status: 'completed',
    message: 'Linear issue created: TEST-123',
    resourceUrl: 'https://linear.app/issue/TEST-123',
  };
  private failNext = false;
  private failError: Error | null = null;

  getProcessedActions(): typeof this.processedActions {
    return this.processedActions;
  }

  setNextResponse(response: ServiceFeedback): void {
    this.nextResponse = response;
  }

  setFailNext(fail: boolean, error?: Error): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async processAction(
    _actionId: string,
    _userId: string,
    _text: string,
    _summary?: string
  ): Promise<Result<ServiceFeedback>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? new Error('Simulated failure'));
    }
    this.processedActions.push({
      actionId: _actionId,
      userId: _userId,
      text: _text,
      ...((_summary !== undefined) && { summary: _summary }),
    });
    return ok(this.nextResponse);
  }
}

export class FakeCodeAgentClient implements CodeAgentClient {
  private submittedTasks: {
    actionId: string;
    approvalEventId: string;
    payload: {
      prompt: string;
      workerType: 'opus' | 'auto' | 'glm';
      linearIssueId?: string;
      linearIssueTitle?: string;
    };
  }[] = [];
  private nextResponse = {
    codeTaskId: 'code-task-123',
    resourceUrl: 'https://app.intexuraos.com/code-tasks/123',
  };
  private nextError: {
    code: 'WORKER_UNAVAILABLE' | 'DUPLICATE' | 'NETWORK_ERROR' | 'UNKNOWN';
    message: string;
    existingTaskId?: string;
  } | null = null;
  private failNext = false;

  getSubmittedTasks(): typeof this.submittedTasks {
    return this.submittedTasks;
  }

  setNextResponse(response: { codeTaskId: string; resourceUrl: string }): void {
    this.nextResponse = response;
    this.nextError = null;
  }

  setNextError(error: {
    code: 'WORKER_UNAVAILABLE' | 'DUPLICATE' | 'NETWORK_ERROR' | 'UNKNOWN';
    message: string;
    existingTaskId?: string;
  }): void {
    this.nextError = error;
  }

  setFailNext(fail: boolean): void {
    this.failNext = fail;
  }

  async submitTask(input: {
    actionId: string;
    approvalEventId: string;
    payload: {
      prompt: string;
      workerType: 'opus' | 'auto' | 'glm';
      linearIssueId?: string;
      linearIssueTitle?: string;
    };
  }): Promise<{
    ok: true;
    value: { codeTaskId: string; resourceUrl: string };
  } | {
    ok: false;
    error: {
      code: 'WORKER_UNAVAILABLE' | 'DUPLICATE' | 'NETWORK_ERROR' | 'UNKNOWN';
      message: string;
      existingTaskId?: string;
    };
  }> {
    if (this.failNext) {
      this.failNext = false;
      return {
        ok: false,
        error: {
          code: 'NETWORK_ERROR',
          message: 'Simulated network failure',
        },
      };
    }

    this.submittedTasks.push(input);

    if (this.nextError !== null) {
      return {
        ok: false,
        error: this.nextError,
      };
    }

    return {
      ok: true,
      value: this.nextResponse,
    };
  }
}

import type { ExecuteResearchActionResult } from '../domain/usecases/executeResearchAction.js';
import type { ExecuteTodoActionResult } from '../domain/usecases/executeTodoAction.js';
import type { ExecuteNoteActionResult } from '../domain/usecases/executeNoteAction.js';
import type { ExecuteLinkActionResult } from '../domain/usecases/executeLinkAction.js';
import type { ExecuteCalendarActionResult } from '../domain/usecases/executeCalendarAction.js';
import type { ExecuteLinearActionResult } from '../domain/usecases/executeLinearAction.js';
import type { ExecuteCodeActionResult } from '../domain/usecases/executeCodeAction.js';
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
        message: 'Research draft created successfully',
        resourceUrl: '/#/research/test-123',
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
        message: 'Todo created successfully',
        resourceUrl: '/#/todos/todo-123',
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
        message: 'Note created successfully',
        resourceUrl: '/#/notes/note-123',
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
        message: 'Bookmark created successfully',
        resourceUrl: '/#/bookmarks/bookmark-123',
      }
    );
  };
}

export type FakeExecuteCalendarActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteCalendarActionResult, Error>>;

export function createFakeExecuteCalendarActionUseCase(config?: {
  failWithError?: Error;
  returnResult?: ExecuteCalendarActionResult;
}): FakeExecuteCalendarActionUseCase {
  return async (_actionId: string): Promise<Result<ExecuteCalendarActionResult, Error>> => {
    if (config?.failWithError !== undefined) {
      return err(config.failWithError);
    }
    return ok(
      config?.returnResult ?? {
        status: 'completed',
        message: 'Calendar event created successfully',
        resourceUrl: '/#/calendar',
      }
    );
  };
}

export type FakeExecuteLinearActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteLinearActionResult, Error>>;

export function createFakeExecuteLinearActionUseCase(config?: {
  failWithError?: Error;
  returnResult?: ExecuteLinearActionResult;
}): FakeExecuteLinearActionUseCase {
  return async (_actionId: string): Promise<Result<ExecuteLinearActionResult, Error>> => {
    if (config?.failWithError !== undefined) {
      return err(config.failWithError);
    }
    return ok(
      config?.returnResult ?? {
        status: 'completed',
        message: 'Linear issue created: TEST-123',
        resourceUrl: 'https://linear.app/issue/TEST-123',
      }
    );
  };
}

export type FakeExecuteCodeActionUseCase = (
  actionId: string
) => Promise<Result<ExecuteCodeActionResult, Error>>;

export function createFakeExecuteCodeActionUseCase(config?: {
  failWithError?: Error;
  returnResult?: ExecuteCodeActionResult;
}): FakeExecuteCodeActionUseCase {
  return async (_actionId: string): Promise<Result<ExecuteCodeActionResult, Error>> => {
    if (config?.failWithError !== undefined) {
      return err(config.failWithError);
    }
    return ok(
      config?.returnResult ?? {
        status: 'completed',
        message: 'Code task created: code-task-123',
        resourceUrl: 'https://app.intexuraos.com/code-tasks/123',
      }
    );
  };
}

/**
 * Fake executeCodeAction use case that updates action repository
 * Use this when you need the action to be marked as completed in the repository
 */
export function createFakeExecuteCodeActionUseCaseWithRepo(
  fakeRepo: FakeActionRepository,
  config?: {
    failWithError?: Error;
    returnResult?: ExecuteCodeActionResult;
  }
): FakeExecuteCodeActionUseCase {
  return async (actionId: string): Promise<Result<ExecuteCodeActionResult, Error>> => {
    if (config?.failWithError !== undefined) {
      return err(config.failWithError);
    }
    const result = config?.returnResult ?? {
      status: 'completed',
      message: 'Code task created: code-task-123',
      resourceUrl: 'https://app.intexuraos.com/code-tasks/123',
    };

    // Update action in repository
    const action = await fakeRepo.getById(actionId);
    if (action !== null) {
      await fakeRepo.save({
        ...action,
        status: 'completed',
        payload: {
          ...action.payload,
          resource_url: result.resourceUrl,
          message: result.message,
          approvalEventId: crypto.randomUUID(),
        },
      });
    }

    return ok(result);
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

// Fake ApprovalMessageRepository
export class FakeApprovalMessageRepository implements ApprovalMessageRepository {
  private messages = new Map<string, ApprovalMessage>();
  private messagesByAction = new Map<string, ApprovalMessage>();
  private failNext = false;
  private failError: ApprovalMessageRepositoryError | null = null;

  setFailNext(fail: boolean, error?: ApprovalMessageRepositoryError): void {
    this.failNext = fail;
    this.failError = error ?? null;
  }

  async save(message: ApprovalMessage): Promise<Result<void, ApprovalMessageRepositoryError>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? { code: 'PERSISTENCE_ERROR', message: 'Simulated failure' });
    }
    this.messages.set(message.wamid, message);
    this.messagesByAction.set(message.actionId, message);
    return ok(undefined);
  }

  async findByWamid(wamid: string): Promise<Result<ApprovalMessage | null, ApprovalMessageRepositoryError>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? { code: 'PERSISTENCE_ERROR', message: 'Simulated failure' });
    }
    return ok(this.messages.get(wamid) ?? null);
  }

  async findByActionId(actionId: string): Promise<Result<ApprovalMessage | null, ApprovalMessageRepositoryError>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? { code: 'PERSISTENCE_ERROR', message: 'Simulated failure' });
    }
    return ok(this.messagesByAction.get(actionId) ?? null);
  }

  async deleteByActionId(actionId: string): Promise<Result<void, ApprovalMessageRepositoryError>> {
    if (this.failNext) {
      this.failNext = false;
      return err(this.failError ?? { code: 'PERSISTENCE_ERROR', message: 'Simulated failure' });
    }
    const message = this.messagesByAction.get(actionId);
    if (message !== undefined) {
      this.messages.delete(message.wamid);
      this.messagesByAction.delete(actionId);
    }
    return ok(undefined);
  }

  // Test helpers
  setMessage(message: ApprovalMessage): void {
    this.messages.set(message.wamid, message);
    this.messagesByAction.set(message.actionId, message);
  }

  getMessages(): ApprovalMessage[] {
    return Array.from(this.messages.values());
  }

  clear(): void {
    this.messages.clear();
    this.messagesByAction.clear();
  }
}

// Fake UserServiceClient
export class FakeUserServiceClient implements UserServiceClient {
  private llmClient: LlmGenerateClient | null = null;
  private error: UserServiceError | null = null;

  setLlmClient(client: LlmGenerateClient): void {
    this.llmClient = client;
    this.error = null;
  }

  setError(error: UserServiceError): void {
    this.error = error;
    this.llmClient = null;
  }

  async getLlmClient(_userId: string): Promise<Result<LlmGenerateClient, UserServiceError>> {
    if (this.error !== null) {
      return err(this.error);
    }
    if (this.llmClient === null) {
      return err({
        code: 'NO_API_KEY',
        message: 'No LLM client configured in fake',
      });
    }
    return ok(this.llmClient);
  }
}

// Fake HandleApprovalReplyUseCase
export function createFakeHandleApprovalReplyUseCase(config?: {
  failWithError?: Error;
  returnResult?: ApprovalReplyResult;
}): HandleApprovalReplyUseCase {
  return async (_input: ApprovalReplyInput): Promise<Result<ApprovalReplyResult>> => {
    if (config?.failWithError !== undefined) {
      return err(config.failWithError);
    }
    return ok(
      config?.returnResult ?? {
        matched: false,
      }
    );
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
import {
  createHandleCalendarActionUseCase,
  type HandleCalendarActionUseCase,
} from '../domain/usecases/handleCalendarAction.js';
import {
  createHandleLinearActionUseCase,
  type HandleLinearActionUseCase,
} from '../domain/usecases/handleLinearAction.js';
import {
  createHandleCodeActionUseCase,
  type HandleCodeActionUseCase,
} from '../domain/usecases/handleCodeAction.js';

export function createFakeServices(deps: {
  actionServiceClient: FakeActionServiceClient;
  researchServiceClient: FakeResearchServiceClient;
  notificationSender: FakeNotificationSender;
  actionRepository?: FakeActionRepository;
  actionTransitionRepository?: FakeActionTransitionRepository;
  commandsAgentClient?: FakeCommandsAgentClient;
  todosServiceClient?: FakeTodosServiceClient;
  notesServiceClient?: FakeNotesServiceClient;
  bookmarksServiceClient?: FakeBookmarksServiceClient;
  calendarServiceClient?: FakeCalendarServiceClient;
  linearAgentClient?: FakeLinearAgentClient;
  codeAgentClient?: FakeCodeAgentClient;
  actionEventPublisher?: FakeActionEventPublisher;
  whatsappPublisher?: FakeWhatsAppSendPublisher;
  calendarPreviewPublisher?: FakeCalendarPreviewPublisher;
  executeResearchActionUseCase?: FakeExecuteResearchActionUseCase;
  executeTodoActionUseCase?: FakeExecuteTodoActionUseCase;
  executeNoteActionUseCase?: FakeExecuteNoteActionUseCase;
  executeLinkActionUseCase?: FakeExecuteLinkActionUseCase;
  executeCalendarActionUseCase?: FakeExecuteCalendarActionUseCase;
  executeLinearActionUseCase?: FakeExecuteLinearActionUseCase;
  executeCodeActionUseCase?: FakeExecuteCodeActionUseCase;
  retryPendingActionsUseCase?: RetryPendingActionsUseCase;
  changeActionTypeUseCase?: ChangeActionTypeUseCase;
  approvalMessageRepository?: FakeApprovalMessageRepository;
  userServiceClient?: FakeUserServiceClient;
  handleApprovalReplyUseCase?: HandleApprovalReplyUseCase;
}): Services {
  const whatsappPublisher = deps.whatsappPublisher ?? new FakeWhatsAppSendPublisher();
  const calendarPreviewPublisher =
    deps.calendarPreviewPublisher ?? new FakeCalendarPreviewPublisher();
  const actionRepository = deps.actionRepository ?? new FakeActionRepository();
  const actionTransitionRepository =
    deps.actionTransitionRepository ?? new FakeActionTransitionRepository();
  const commandsAgentClient = deps.commandsAgentClient ?? new FakeCommandsAgentClient();
  const todosServiceClient = deps.todosServiceClient ?? new FakeTodosServiceClient();
  const notesServiceClient = deps.notesServiceClient ?? new FakeNotesServiceClient();
  const bookmarksServiceClient = deps.bookmarksServiceClient ?? new FakeBookmarksServiceClient();
  const calendarServiceClient = deps.calendarServiceClient ?? new FakeCalendarServiceClient();
  const linearAgentClient = deps.linearAgentClient ?? new FakeLinearAgentClient();
  const codeAgentClient = deps.codeAgentClient ?? new FakeCodeAgentClient();
  const approvalMessageRepository =
    deps.approvalMessageRepository ?? new FakeApprovalMessageRepository();
  const userServiceClient = deps.userServiceClient ?? new FakeUserServiceClient();

  const silentLogger = pino({ level: 'silent' });

  const handleResearchActionUseCase: HandleResearchActionUseCase = registerActionHandler(
    createHandleResearchActionUseCase,
    {
      actionRepository,
      whatsappPublisher,
      webAppUrl: 'http://test.app',
      logger: silentLogger,
    }
  );

  const handleTodoActionUseCase: HandleTodoActionUseCase = registerActionHandler(
    createHandleTodoActionUseCase,
    {
      actionRepository,
      whatsappPublisher,
      webAppUrl: 'http://test.app',
      logger: silentLogger,
    }
  );

  const handleNoteActionUseCase: HandleNoteActionUseCase = registerActionHandler(
    createHandleNoteActionUseCase,
    {
      actionRepository,
      whatsappPublisher,
      webAppUrl: 'http://test.app',
      logger: silentLogger,
    }
  );

  const handleLinkActionUseCase: HandleLinkActionUseCase = registerActionHandler(
    createHandleLinkActionUseCase,
    {
      actionRepository,
      whatsappPublisher,
      webAppUrl: 'http://test.app',
      logger: silentLogger,
    }
  );

  const handleCalendarActionUseCase: HandleCalendarActionUseCase = registerActionHandler(
    createHandleCalendarActionUseCase,
    {
      actionRepository,
      whatsappPublisher,
      calendarPreviewPublisher,
      webAppUrl: 'http://test.app',
      logger: silentLogger,
    }
  );

  const handleLinearActionUseCase: HandleLinearActionUseCase = registerActionHandler(
    createHandleLinearActionUseCase,
    {
      actionRepository,
      whatsappPublisher,
      webAppUrl: 'http://test.app',
      logger: silentLogger,
    }
  );

  const handleCodeActionUseCase: HandleCodeActionUseCase = registerActionHandler(
    createHandleCodeActionUseCase,
    {
      actionRepository,
      whatsappPublisher,
      webAppUrl: 'http://test.app',
      logger: silentLogger,
    }
  );

  const changeActionTypeUseCase: ChangeActionTypeUseCase =
    deps.changeActionTypeUseCase ??
    createChangeActionTypeUseCase({
      actionRepository,
      actionTransitionRepository,
      commandsAgentClient,
      logger: pino({ level: 'silent' }),
    });

  return {
    actionServiceClient: deps.actionServiceClient,
    researchServiceClient: deps.researchServiceClient,
    notificationSender: deps.notificationSender,
    actionRepository,
    actionTransitionRepository,
    commandsAgentClient,
    todosServiceClient,
    notesServiceClient,
    bookmarksServiceClient,
    calendarServiceClient,
    linearAgentClient,
    codeAgentClient,
    actionEventPublisher: deps.actionEventPublisher ?? new FakeActionEventPublisher(),
    whatsappPublisher,
    calendarPreviewPublisher,
    handleResearchActionUseCase,
    handleTodoActionUseCase,
    handleNoteActionUseCase,
    handleLinkActionUseCase,
    handleCalendarActionUseCase,
    handleLinearActionUseCase,
    handleCodeActionUseCase,
    executeResearchActionUseCase:
      deps.executeResearchActionUseCase ?? createFakeExecuteResearchActionUseCase(),
    executeTodoActionUseCase: deps.executeTodoActionUseCase ?? createFakeExecuteTodoActionUseCase(),
    executeNoteActionUseCase: deps.executeNoteActionUseCase ?? createFakeExecuteNoteActionUseCase(),
    executeLinkActionUseCase: deps.executeLinkActionUseCase ?? createFakeExecuteLinkActionUseCase(),
    executeCalendarActionUseCase:
      deps.executeCalendarActionUseCase ?? createFakeExecuteCalendarActionUseCase(),
    executeLinearActionUseCase:
      deps.executeLinearActionUseCase ?? createFakeExecuteLinearActionUseCase(),
    executeCodeActionUseCase: deps.executeCodeActionUseCase ?? createFakeExecuteCodeActionUseCase(),
    retryPendingActionsUseCase:
      deps.retryPendingActionsUseCase ?? createFakeRetryPendingActionsUseCase(),
    changeActionTypeUseCase,
    approvalMessageRepository,
    userServiceClient,
    handleApprovalReplyUseCase:
      deps.handleApprovalReplyUseCase ?? createFakeHandleApprovalReplyUseCase(),
    research: handleResearchActionUseCase,
    todo: handleTodoActionUseCase,
    note: handleNoteActionUseCase,
    link: handleLinkActionUseCase,
    calendar: handleCalendarActionUseCase,
    linear: handleLinearActionUseCase,
    code: handleCodeActionUseCase,
  };
}
