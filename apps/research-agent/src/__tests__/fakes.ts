import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { ActionServiceClient } from '../domain/ports/actionServiceClient.js';
import type { ResearchServiceClient } from '../domain/ports/researchServiceClient.js';
import type { NotificationSender } from '../domain/ports/notificationSender.js';
import type { LlmProvider } from '../domain/models/actionEvent.js';
import {
  createHandleResearchActionUseCase,
  type HandleResearchActionUseCase,
} from '../domain/usecases/handleResearchAction.js';
import type { Services } from '../services.js';

export class FakeActionServiceClient implements ActionServiceClient {
  private statusUpdates: Map<string, string> = new Map();
  private actionUpdates: Map<string, { status: string; payload?: Record<string, unknown> }> =
    new Map();
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
  private notifications: Array<{
    userId: string;
    researchId: string;
    title: string;
    draftUrl: string;
  }> = [];
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

export function createFakeServices(deps: {
  actionServiceClient: FakeActionServiceClient;
  researchServiceClient: FakeResearchServiceClient;
  notificationSender: FakeNotificationSender;
}): Services {
  const handleResearchActionUseCase: HandleResearchActionUseCase =
    createHandleResearchActionUseCase({
      actionServiceClient: deps.actionServiceClient,
      researchServiceClient: deps.researchServiceClient,
      notificationSender: deps.notificationSender,
    });

  return {
    actionServiceClient: deps.actionServiceClient,
    researchServiceClient: deps.researchServiceClient,
    notificationSender: deps.notificationSender,
    handleResearchActionUseCase,
  };
}
