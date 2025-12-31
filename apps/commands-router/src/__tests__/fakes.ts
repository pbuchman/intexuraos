import type { Command } from '../domain/models/command.js';
import type { Action } from '../domain/models/action.js';
import type { CommandRepository } from '../domain/ports/commandRepository.js';
import type { ActionRepository } from '../domain/ports/actionRepository.js';
import type { Classifier, ClassificationResult } from '../domain/ports/classifier.js';

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
