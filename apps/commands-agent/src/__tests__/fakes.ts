import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import pino from 'pino';
import type { Command, CommandStatus } from '../domain/models/command.js';
import type { Action } from '../domain/models/action.js';
import type { CommandRepository } from '../domain/ports/commandRepository.js';
import type {
  Classifier,
  ClassificationResult,
  ClassifierFactory,
} from '../domain/ports/classifier.js';
import type { EventPublisherPort, PublishError } from '../domain/ports/eventPublisher.js';
import type { ActionCreatedEvent } from '../domain/events/actionCreatedEvent.js';
import type { UserServiceClient, UserApiKeys, UserServiceError } from '../infra/user/index.js';
import type { ActionsAgentClient, CreateActionParams } from '../infra/actionsAgent/client.js';
import { createProcessCommandUseCase } from '../domain/usecases/processCommand.js';
import { createRetryPendingCommandsUseCase } from '../domain/usecases/retryPendingCommands.js';
import type { Services } from '../services.js';

export class FakeCommandRepository implements CommandRepository {
  private commands = new Map<string, Command>();
  private userCommands = new Map<string, Command[]>();

  addCommand(command: Command): void {
    this.commands.set(command.id, command);
    const userList = this.userCommands.get(command.userId) ?? [];
    userList.push(command);
    this.userCommands.set(command.userId, userList);
  }

  async getById(id: string): Promise<Command | null> {
    return this.commands.get(id) ?? null;
  }

  async save(command: Command): Promise<void> {
    this.commands.set(command.id, command);
    const userList = this.userCommands.get(command.userId) ?? [];
    userList.push(command);
    this.userCommands.set(command.userId, userList);
  }

  async update(command: Command): Promise<void> {
    this.commands.set(command.id, command);
    const userId = command.userId;
    const userList = this.userCommands.get(userId) ?? [];
    const index = userList.findIndex((c) => c.id === command.id);
    if (index >= 0) {
      userList[index] = command;
    }
    this.userCommands.set(userId, userList);
  }

  async delete(id: string): Promise<void> {
    const command = this.commands.get(id);
    if (command !== undefined) {
      this.commands.delete(id);
      const userList = this.userCommands.get(command.userId) ?? [];
      const filtered = userList.filter((c) => c.id !== id);
      this.userCommands.set(command.userId, filtered);
    }
  }

  async listByUserId(userId: string): Promise<Command[]> {
    return this.userCommands.get(userId) ?? [];
  }

  async listByStatus(status: CommandStatus, limit = 100): Promise<Command[]> {
    const matching: Command[] = [];
    for (const command of this.commands.values()) {
      if (command.status === status) {
        matching.push(command);
      }
    }
    matching.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return matching.slice(0, limit);
  }
}

export class FakeActionsAgentClient implements ActionsAgentClient {
  private createdActions: Action[] = [];
  private failNext = false;

  async createAction(params: CreateActionParams): Promise<Result<Action>> {
    if (this.failNext) {
      this.failNext = false;
      return err(new Error('Actions-agent client error'));
    }

    const action: Action = {
      id: `action-${Date.now()}`,
      userId: params.userId,
      commandId: params.commandId,
      type: params.type,
      title: params.title,
      status: 'pending',
      confidence: params.confidence,
      payload: params.payload ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.createdActions.push(action);
    return ok(action);
  }

  setFailNext(fail: boolean): void {
    this.failNext = fail;
  }

  getCreatedActions(): Action[] {
    return [...this.createdActions];
  }
}

export class FakeClassifier implements Classifier {
  private result: ClassificationResult = {
    type: 'todo',
    confidence: 0.9,
    title: 'Test Task',
    reasoning: 'Contains task-related keywords indicating a todo item',
  };
  private failNext = false;

  setResult(result: ClassificationResult): void {
    this.result = result;
  }

  setFailNext(fail: boolean): void {
    this.failNext = fail;
  }

  async classify(_text: string): Promise<ClassificationResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Simulated classification failure');
    }
    return this.result;
  }
}

export class FakeUserServiceClient implements UserServiceClient {
  private apiKeys = new Map<string, UserApiKeys>();
  private failNext = false;

  setApiKeys(userId: string, keys: UserApiKeys): void {
    this.apiKeys.set(userId, keys);
  }

  setFailNext(fail: boolean): void {
    this.failNext = fail;
  }

  async getApiKeys(userId: string): Promise<Result<UserApiKeys, UserServiceError>> {
    if (this.failNext) {
      this.failNext = false;
      return err({ code: 'NETWORK_ERROR', message: 'Simulated network error' });
    }
    return ok(this.apiKeys.get(userId) ?? {});
  }
}

export class FakeEventPublisher implements EventPublisherPort {
  private publishedEvents: ActionCreatedEvent[] = [];
  private failNext = false;

  getPublishedEvents(): ActionCreatedEvent[] {
    return this.publishedEvents;
  }

  setFailNext(fail: boolean): void {
    this.failNext = fail;
  }

  async publishActionCreated(event: ActionCreatedEvent): Promise<Result<void, PublishError>> {
    if (this.failNext) {
      this.failNext = false;
      return err({ code: 'PUBLISH_FAILED', message: 'Simulated publish failure' });
    }
    this.publishedEvents.push(event);
    return ok(undefined);
  }
}

export function createFakeServices(deps: {
  commandRepository: FakeCommandRepository;
  actionsAgentClient: FakeActionsAgentClient;
  classifier: FakeClassifier;
  userServiceClient: FakeUserServiceClient;
  eventPublisher: FakeEventPublisher;
}): Services {
  const classifierFactory: ClassifierFactory = () => deps.classifier;
  const logger = pino({ name: 'commands-agent-test', level: 'silent' });

  return {
    commandRepository: deps.commandRepository,
    actionsAgentClient: deps.actionsAgentClient,
    classifierFactory,
    userServiceClient: deps.userServiceClient,
    eventPublisher: deps.eventPublisher,
    processCommandUseCase: createProcessCommandUseCase({
      commandRepository: deps.commandRepository,
      actionsAgentClient: deps.actionsAgentClient,
      classifierFactory,
      userServiceClient: deps.userServiceClient,
      eventPublisher: deps.eventPublisher,
      logger,
    }),
    retryPendingCommandsUseCase: createRetryPendingCommandsUseCase({
      commandRepository: deps.commandRepository,
      actionsAgentClient: deps.actionsAgentClient,
      classifierFactory,
      userServiceClient: deps.userServiceClient,
      eventPublisher: deps.eventPublisher,
      logger,
    }),
  };
}
