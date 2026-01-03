import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { ActionServiceClient } from '../domain/ports/actionServiceClient.js';
import type { ResearchServiceClient } from '../domain/ports/researchServiceClient.js';
import type { NotificationSender } from '../domain/ports/notificationSender.js';
import type { ActionRepository, ListByUserIdOptions } from '../domain/ports/actionRepository.js';
import type { Action } from '../domain/models/action.js';
import type {
  ActionFilterOptionField,
  ActionFiltersData,
  CreateSavedActionFilterInput,
  SavedActionFilter,
} from '../domain/models/actionFilters.js';
import type { ActionFiltersRepository } from '../domain/ports/actionFiltersRepository.js';
import type { ActionCreatedEvent, LlmProvider } from '../domain/models/actionEvent.js';
import {
  createHandleResearchActionUseCase,
  type HandleResearchActionUseCase,
} from '../domain/usecases/handleResearchAction.js';
import type { Services } from '../services.js';
import type { PublishError, WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ActionEventPublisher } from '../infra/pubsub/index.js';

export class FakeActionServiceClient implements ActionServiceClient {
  private statusUpdates = new Map<string, string>();
  private actionUpdates = new Map<string, { status: string; payload?: Record<string, unknown> }>();
  private failNext = false;
  private failError: Error | null = null;

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

  async updateActionStatus(actionId: string, status: string): Promise<Result<void>> {
    if (this.failNext) {
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
    if (this.failNext) {
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
    selectedLlms: LlmProvider[];
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
    selectedLlms: LlmProvider[];
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

export class FakeActionFiltersRepository implements ActionFiltersRepository {
  private filtersData = new Map<string, ActionFiltersData>();
  private shouldFail = false;

  setFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  async getByUserId(userId: string): Promise<ActionFiltersData | null> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error('Simulated failure');
    }

    return this.filtersData.get(userId) ?? null;
  }

  async addOption(userId: string, field: ActionFilterOptionField, value: string): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error('Simulated failure');
    }

    const now = new Date().toISOString();
    let data = this.filtersData.get(userId);

    if (data === undefined) {
      data = {
        userId,
        options: { status: [], type: [] },
        savedFilters: [],
        createdAt: now,
        updatedAt: now,
      };
    }

    if (!data.options[field].includes(value as never)) {
      (data.options[field] as string[]).push(value);
      data.updatedAt = now;
    }

    this.filtersData.set(userId, data);
  }

  async addOptions(
    userId: string,
    options: Partial<Record<ActionFilterOptionField, string>>
  ): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error('Simulated failure');
    }

    const now = new Date().toISOString();
    let data = this.filtersData.get(userId);

    if (data === undefined) {
      data = {
        userId,
        options: { status: [], type: [] },
        savedFilters: [],
        createdAt: now,
        updatedAt: now,
      };
    }

    for (const [field, value] of Object.entries(options)) {
      const f = field as ActionFilterOptionField;
      if (value !== undefined && !data.options[f].includes(value as never)) {
        (data.options[f] as string[]).push(value);
      }
    }

    data.updatedAt = now;
    this.filtersData.set(userId, data);
  }

  async addSavedFilter(
    userId: string,
    filter: CreateSavedActionFilterInput
  ): Promise<SavedActionFilter> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error('Simulated failure');
    }

    const now = new Date().toISOString();
    let data = this.filtersData.get(userId);

    if (data === undefined) {
      data = {
        userId,
        options: { status: [], type: [] },
        savedFilters: [],
        createdAt: now,
        updatedAt: now,
      };
    }

    const savedFilter: SavedActionFilter = {
      id: crypto.randomUUID(),
      name: filter.name,
      createdAt: now,
    };

    if (filter.status !== undefined) savedFilter.status = filter.status;
    if (filter.type !== undefined) savedFilter.type = filter.type;

    data.savedFilters.push(savedFilter);
    data.updatedAt = now;
    this.filtersData.set(userId, data);

    return savedFilter;
  }

  async deleteSavedFilter(userId: string, filterId: string): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error('Simulated failure');
    }

    const data = this.filtersData.get(userId);
    if (data === undefined) {
      throw new Error('Filter data not found for user');
    }

    const index = data.savedFilters.findIndex((f) => f.id === filterId);
    if (index === -1) {
      throw new Error('Saved filter not found');
    }

    data.savedFilters.splice(index, 1);
    data.updatedAt = new Date().toISOString();
    this.filtersData.set(userId, data);
  }

  clear(): void {
    this.filtersData.clear();
  }
}

import type { ExecuteResearchActionResult } from '../domain/usecases/executeResearchAction.js';
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
        resource_url: '/#/research/test-123/edit',
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

export function createFakeServices(deps: {
  actionServiceClient: FakeActionServiceClient;
  researchServiceClient: FakeResearchServiceClient;
  notificationSender: FakeNotificationSender;
  actionRepository?: FakeActionRepository;
  actionFiltersRepository?: FakeActionFiltersRepository;
  actionEventPublisher?: FakeActionEventPublisher;
  whatsappPublisher?: FakeWhatsAppSendPublisher;
  executeResearchActionUseCase?: FakeExecuteResearchActionUseCase;
  retryPendingActionsUseCase?: RetryPendingActionsUseCase;
}): Services {
  const whatsappPublisher = deps.whatsappPublisher ?? new FakeWhatsAppSendPublisher();

  const handleResearchActionUseCase: HandleResearchActionUseCase =
    createHandleResearchActionUseCase({
      actionServiceClient: deps.actionServiceClient,
      whatsappPublisher,
      webAppUrl: 'http://test.app',
    });

  return {
    actionServiceClient: deps.actionServiceClient,
    researchServiceClient: deps.researchServiceClient,
    notificationSender: deps.notificationSender,
    actionRepository: deps.actionRepository ?? new FakeActionRepository(),
    actionFiltersRepository: deps.actionFiltersRepository ?? new FakeActionFiltersRepository(),
    actionEventPublisher: deps.actionEventPublisher ?? new FakeActionEventPublisher(),
    whatsappPublisher,
    handleResearchActionUseCase,
    executeResearchActionUseCase:
      deps.executeResearchActionUseCase ?? createFakeExecuteResearchActionUseCase(),
    retryPendingActionsUseCase:
      deps.retryPendingActionsUseCase ?? createFakeRetryPendingActionsUseCase(),
    research: handleResearchActionUseCase,
  };
}
