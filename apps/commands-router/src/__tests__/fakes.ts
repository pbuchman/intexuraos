import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import pino from 'pino';
import type { Command } from '../domain/models/command.js';
import type { Action } from '../domain/models/action.js';
import type { CommandRepository } from '../domain/ports/commandRepository.js';
import type { ActionRepository } from '../domain/ports/actionRepository.js';
import type {
  Classifier,
  ClassificationResult,
  ClassifierFactory,
} from '../domain/ports/classifier.js';
import type { EventPublisherPort, PublishError } from '../domain/ports/eventPublisher.js';
import type { ActionCreatedEvent } from '../domain/events/actionCreatedEvent.js';
import type { UserServiceClient, UserApiKeys, UserServiceError } from '../infra/user/index.js';
import { createProcessCommandUseCase } from '../domain/usecases/processCommand.js';
import type { Services } from '../services.js';

export class FakeCommandRepository implements CommandRepository {
  private commands: Map<string, Command> = new Map();
  private userCommands: Map<string, Command[]> = new Map();

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

  async listByUserId(userId: string): Promise<Command[]> {
    return this.userCommands.get(userId) ?? [];
  }
}

export class FakeActionRepository implements ActionRepository {
  private actions: Map<string, Action> = new Map();
  private userActions: Map<string, Action[]> = new Map();

  addAction(action: Action): void {
    this.actions.set(action.id, action);
    const userList = this.userActions.get(action.userId) ?? [];
    userList.push(action);
    this.userActions.set(action.userId, userList);
  }

  async getById(id: string): Promise<Action | null> {
    return this.actions.get(id) ?? null;
  }

  async save(action: Action): Promise<void> {
    this.actions.set(action.id, action);
    const userList = this.userActions.get(action.userId) ?? [];
    userList.push(action);
    this.userActions.set(action.userId, userList);
  }

  async update(action: Action): Promise<void> {
    this.actions.set(action.id, action);
    const userId = action.userId;
    const userList = this.userActions.get(userId) ?? [];
    const index = userList.findIndex((a) => a.id === action.id);
    if (index >= 0) {
      userList[index] = action;
    }
    this.userActions.set(userId, userList);
  }

  async listByUserId(userId: string): Promise<Action[]> {
    return this.userActions.get(userId) ?? [];
  }
}

export class FakeClassifier implements Classifier {
  private result: ClassificationResult = {
    type: 'todo',
    confidence: 0.9,
    title: 'Test Task',
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
  private apiKeys: Map<string, UserApiKeys> = new Map();
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
  actionRepository: FakeActionRepository;
  classifier: FakeClassifier;
  userServiceClient: FakeUserServiceClient;
  eventPublisher: FakeEventPublisher;
}): Services {
  const classifierFactory: ClassifierFactory = () => deps.classifier;
  const logger = pino({ name: 'commands-router-test', level: 'silent' });

  return {
    commandRepository: deps.commandRepository,
    actionRepository: deps.actionRepository,
    classifierFactory,
    userServiceClient: deps.userServiceClient,
    eventPublisher: deps.eventPublisher,
    processCommandUseCase: createProcessCommandUseCase({
      commandRepository: deps.commandRepository,
      actionRepository: deps.actionRepository,
      classifierFactory,
      userServiceClient: deps.userServiceClient,
      eventPublisher: deps.eventPublisher,
      logger,
    }),
  };
}
