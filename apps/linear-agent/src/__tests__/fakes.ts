/**
 * Test fakes for linear-agent.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  LinearConnectionRepository,
  LinearConnection,
  LinearConnectionPublic,
  LinearError,
  LinearApiClient,
  LinearTeam,
  LinearIssue,
  CreateIssueInput,
  LinearActionExtractionService,
  ExtractedIssueData,
  FailedIssueRepository,
  FailedLinearIssue,
  ProcessedActionRepository,
  ProcessedAction,
} from '../domain/index.js';

export class FakeLinearConnectionRepository implements LinearConnectionRepository {
  private connections = new Map<string, LinearConnection>();
  private shouldFailGetFullConnection = false;
  private failError: LinearError = { code: 'INTERNAL_ERROR', message: 'Database error' };

  async save(
    userId: string,
    apiKey: string,
    teamId: string,
    teamName: string
  ): Promise<Result<LinearConnectionPublic, LinearError>> {
    const now = new Date().toISOString();
    const existing = this.connections.get(userId);

    const connection: LinearConnection = {
      userId,
      apiKey,
      teamId,
      teamName,
      connected: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.connections.set(userId, connection);

    return ok({
      connected: true,
      teamId,
      teamName,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    });
  }

  async getConnection(userId: string): Promise<Result<LinearConnectionPublic | null, LinearError>> {
    const conn = this.connections.get(userId);
    if (!conn) return ok(null);

    return ok({
      connected: conn.connected,
      teamId: conn.connected ? conn.teamId : null,
      teamName: conn.connected ? conn.teamName : null,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    });
  }

  async getApiKey(userId: string): Promise<Result<string | null, LinearError>> {
    const conn = this.connections.get(userId);
    if (!conn || !conn.connected) return ok(null);
    return ok(conn.apiKey);
  }

  async getFullConnection(userId: string): Promise<Result<LinearConnection | null, LinearError>> {
    if (this.shouldFailGetFullConnection) return err(this.failError);
    const conn = this.connections.get(userId);
    if (!conn || !conn.connected) return ok(null);
    return ok(conn);
  }

  setGetFullConnectionFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailGetFullConnection = fail;
    if (error) this.failError = error;
  }

  async isConnected(userId: string): Promise<Result<boolean, LinearError>> {
    const conn = this.connections.get(userId);
    return ok(conn?.connected ?? false);
  }

  async disconnect(userId: string): Promise<Result<LinearConnectionPublic, LinearError>> {
    const conn = this.connections.get(userId);
    const now = new Date().toISOString();

    if (conn) {
      conn.connected = false;
      conn.updatedAt = now;
    }

    return ok({
      connected: false,
      teamId: null,
      teamName: null,
      createdAt: conn?.createdAt ?? now,
      updatedAt: now,
    });
  }

  reset(): void {
    this.connections.clear();
    this.shouldFailGetFullConnection = false;
  }

  seedConnection(conn: LinearConnection): void {
    this.connections.set(conn.userId, conn);
  }
}

export class FakeLinearApiClient implements LinearApiClient {
  private teams: LinearTeam[] = [{ id: 'team-1', name: 'Engineering', key: 'ENG' }];
  private issues: LinearIssue[] = [];
  private shouldFail = false;
  private failError: LinearError = { code: 'API_ERROR', message: 'Fake error' };
  private issueCounter = 1;

  async validateAndGetTeams(apiKey: string): Promise<Result<LinearTeam[], LinearError>> {
    if (this.shouldFail) return err(this.failError);
    if (apiKey === 'invalid') {
      return err({ code: 'INVALID_API_KEY', message: 'Invalid API key' });
    }
    return ok(this.teams);
  }

  async createIssue(
    _apiKey: string,
    input: CreateIssueInput
  ): Promise<Result<LinearIssue, LinearError>> {
    if (this.shouldFail) return err(this.failError);

    const issue: LinearIssue = {
      id: `issue-${Date.now()}-${this.issueCounter++}`,
      identifier: `ENG-${this.issueCounter}`,
      title: input.title,
      description: input.description,
      priority: input.priority,
      state: { id: 'state-1', name: 'Backlog', type: 'backlog' },
      url: `https://linear.app/team/issue/ENG-${this.issueCounter}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };

    this.issues.push(issue);
    return ok(issue);
  }

  async listIssues(
    _apiKey: string,
    _teamId: string,
    _options?: { completedSinceDays?: number }
  ): Promise<Result<LinearIssue[], LinearError>> {
    if (this.shouldFail) return err(this.failError);
    return ok(this.issues);
  }

  async getIssue(
    _apiKey: string,
    issueId: string
  ): Promise<Result<LinearIssue | null, LinearError>> {
    if (this.shouldFail) return err(this.failError);
    const issue = this.issues.find((i) => i.id === issueId);
    return ok(issue ?? null);
  }

  reset(): void {
    this.issues = [];
    this.shouldFail = false;
    this.issueCounter = 1;
  }

  setTeams(teams: LinearTeam[]): void {
    this.teams = teams;
  }

  seedIssue(issue: LinearIssue): void {
    this.issues.push(issue);
  }

  setFailure(fail: boolean, error?: LinearError): void {
    this.shouldFail = fail;
    if (error) this.failError = error;
  }
}

export class FakeLinearActionExtractionService implements LinearActionExtractionService {
  private defaultResponse: ExtractedIssueData = {
    title: 'Test Issue',
    priority: 0,
    functionalRequirements: null,
    technicalDetails: null,
    valid: true,
    error: null,
    reasoning: 'Test extraction',
  };
  private customResponse: Partial<ExtractedIssueData> | null = null;
  private shouldFail = false;
  private failError: LinearError = { code: 'EXTRACTION_FAILED', message: 'Fake extraction error' };

  async extractIssue(
    _userId: string,
    text: string
  ): Promise<Result<ExtractedIssueData, LinearError>> {
    if (this.shouldFail) return err(this.failError);

    // Use custom response if set, otherwise use default with truncated text
    if (this.customResponse !== null) {
      return ok({ ...this.defaultResponse, ...this.customResponse });
    }

    return ok({ ...this.defaultResponse, title: text.slice(0, 50) });
  }

  setResponse(response: Partial<ExtractedIssueData>): void {
    this.customResponse = response;
  }

  setFailure(fail: boolean, error?: LinearError): void {
    this.shouldFail = fail;
    if (error) this.failError = error;
  }

  reset(): void {
    this.customResponse = null;
    this.shouldFail = false;
  }
}

export class FakeFailedIssueRepository implements FailedIssueRepository {
  private failedIssues: FailedLinearIssue[] = [];
  private counter = 1;

  async create(input: {
    userId: string;
    actionId: string;
    originalText: string;
    extractedTitle: string | null;
    extractedPriority: number | null;
    error: string;
    reasoning: string | null;
  }): Promise<Result<FailedLinearIssue, LinearError>> {
    const failedIssue: FailedLinearIssue = {
      id: `failed-${this.counter++}`,
      userId: input.userId,
      actionId: input.actionId,
      originalText: input.originalText,
      extractedTitle: input.extractedTitle,
      extractedPriority: input.extractedPriority as 0 | 1 | 2 | 3 | 4 | null,
      error: input.error,
      reasoning: input.reasoning,
      createdAt: new Date().toISOString(),
    };
    this.failedIssues.push(failedIssue);
    return ok(failedIssue);
  }

  async listByUser(userId: string): Promise<Result<FailedLinearIssue[], LinearError>> {
    const userIssues = this.failedIssues.filter((fi) => fi.userId === userId);
    return ok(userIssues);
  }

  async delete(id: string): Promise<Result<void, LinearError>> {
    this.failedIssues = this.failedIssues.filter((fi) => fi.id !== id);
    return ok(undefined);
  }

  reset(): void {
    this.failedIssues = [];
    this.counter = 1;
  }

  get count(): number {
    return this.failedIssues.length;
  }
}

export class FakeProcessedActionRepository implements ProcessedActionRepository {
  private processedActions = new Map<string, ProcessedAction>();

  async getByActionId(actionId: string): Promise<Result<ProcessedAction | null, LinearError>> {
    const action = this.processedActions.get(actionId);
    return ok(action ?? null);
  }

  async create(input: {
    actionId: string;
    userId: string;
    issueId: string;
    issueIdentifier: string;
    resourceUrl: string;
  }): Promise<Result<ProcessedAction, LinearError>> {
    const processedAction: ProcessedAction = {
      actionId: input.actionId,
      userId: input.userId,
      issueId: input.issueId,
      issueIdentifier: input.issueIdentifier,
      resourceUrl: input.resourceUrl,
      createdAt: new Date().toISOString(),
    };
    this.processedActions.set(input.actionId, processedAction);
    return ok(processedAction);
  }

  reset(): void {
    this.processedActions.clear();
  }

  seedProcessedAction(action: ProcessedAction): void {
    this.processedActions.set(action.actionId, action);
  }

  get count(): number {
    return this.processedActions.size;
  }
}
