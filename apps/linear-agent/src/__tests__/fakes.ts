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
  LinearIssueWithTeam,
  CreateIssueInput,
  LinearActionExtractionService,
  ExtractedIssueData,
  FailedIssueRepository,
  FailedLinearIssue,
  ProcessedActionRepository,
  ProcessedAction,
  WorkflowState,
  LinearIssueRepository,
  SyncedLinearIssue,
  LinearCommentRepository,
  LinearComment,
} from '../domain/index.js';
import type { UserServiceClient, UserServiceError } from '@intexuraos/internal-clients';
import type { CodeAgentClient, CodeAgentError, TriggerCodeTaskResponse } from '../domain/index.js';
import type { LlmGenerateClient, GenerateResult } from '@intexuraos/llm-factory';
import type { LLMError, LLMErrorCode } from '@intexuraos/llm-contract';
import type { IssueStateCategory, LinearPriority } from '../domain/models.js';

/**
 * Helper to create SyncedLinearIssue test fixtures with defaults
 */
export function createSyncedIssue(
  overrides: Partial<SyncedLinearIssue> & { id: string; identifier: string; userId: string }
): SyncedLinearIssue {
  const now = new Date().toISOString();
  return {
    title: 'Test Issue',
    description: null,
    state: 'Backlog',
    stateType: 'backlog' as IssueStateCategory,
    priority: 0 as LinearPriority,
    assigneeId: null,
    assigneeName: null,
    labels: [],
    url: 'https://linear.app/test/issue/test',
    createdAt: now,
    updatedAt: now,
    syncedAt: now,
    teamId: 'team-123',
    parentId: null,
    ...overrides,
  };
}

export class FakeLinearConnectionRepository implements LinearConnectionRepository {
  private connections = new Map<string, LinearConnection>();
  private shouldFailGetFullConnection = false;
  private shouldFailGetConnection = false;
  private shouldFailSave = false;
  private shouldFailDisconnect = false;
  private failError: LinearError = { code: 'INTERNAL_ERROR', message: 'Database error' };

  async save(
    userId: string,
    apiKey: string,
    teamId: string,
    teamName: string
  ): Promise<Result<LinearConnectionPublic, LinearError>> {
    if (this.shouldFailSave) return err(this.failError);

    const now = new Date().toISOString();
    const existing = this.connections.get(userId);

    const connection: LinearConnection = {
      userId,
      apiKey,
      teamId,
      teamName,
      webhookSecret: existing?.webhookSecret ?? null,
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
    if (this.shouldFailGetConnection) return err(this.failError);

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

  setGetConnectionFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailGetConnection = fail;
    if (error) this.failError = error;
  }

  setSaveFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailSave = fail;
    if (error) this.failError = error;
  }

  setDisconnectFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailDisconnect = fail;
    if (error) this.failError = error;
  }

  private shouldFailIsConnected = false;

  async isConnected(userId: string): Promise<Result<boolean, LinearError>> {
    if (this.shouldFailIsConnected) return err(this.failError);
    const conn = this.connections.get(userId);
    return ok(conn?.connected ?? false);
  }

  setIsConnectedFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailIsConnected = fail;
    if (error) this.failError = error;
  }

  async disconnect(userId: string): Promise<Result<LinearConnectionPublic, LinearError>> {
    if (this.shouldFailDisconnect) return err(this.failError);

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

  async findUserIdsByTeamId(teamId: string): Promise<Result<string[], LinearError>> {
    if (this.shouldFailGetConnection) return err(this.failError);

    const userIds: string[] = [];
    for (const [userId, conn] of this.connections.entries()) {
      if (conn.connected && conn.teamId === teamId) {
        userIds.push(userId);
      }
    }
    return ok(userIds);
  }

  async findWebhookSecretByTeamId(
    teamId: string
  ): Promise<Result<{ userId: string; webhookSecret: string } | null, LinearError>> {
    if (this.shouldFailGetConnection) return err(this.failError);

    for (const [userId, conn] of this.connections.entries()) {
      if (conn.connected && conn.teamId === teamId) {
        if (!conn.webhookSecret) return ok(null);
        return ok({ userId, webhookSecret: conn.webhookSecret });
      }
    }
    return ok(null);
  }

  async updateWebhookSecret(
    userId: string,
    webhookSecret: string | null
  ): Promise<Result<void, LinearError>> {
    if (this.shouldFailSave) return err(this.failError);

    const conn = this.connections.get(userId);
    if (conn) {
      conn.webhookSecret = webhookSecret;
      conn.updatedAt = new Date().toISOString();
    }
    return ok(undefined);
  }

  async getAllConnectedUserIds(): Promise<Result<string[], LinearError>> {
    if (this.shouldFailGetConnection) return err(this.failError);

    const connectedUserIds: string[] = [];
    for (const [userId, conn] of this.connections.entries()) {
      if (conn.connected) {
        connectedUserIds.push(userId);
      }
    }
    return ok(connectedUserIds);
  }

  reset(): void {
    this.connections.clear();
    this.shouldFailGetFullConnection = false;
    this.shouldFailGetConnection = false;
    this.shouldFailSave = false;
    this.shouldFailDisconnect = false;
    this.shouldFailIsConnected = false;
  }

  seedConnection(conn: Omit<LinearConnection, 'webhookSecret'> & { webhookSecret?: string | null }): void {
    this.connections.set(conn.userId, {
      ...conn,
      webhookSecret: conn.webhookSecret ?? null,
    } as LinearConnection);
  }
}

export class FakeLinearApiClient implements LinearApiClient {
  private teams: LinearTeam[] = [{ id: 'team-1', name: 'Engineering', key: 'ENG' }];
  private issues: LinearIssue[] = [];
  private issuesWithTeam: LinearIssueWithTeam[] = [];
  private shouldFail = false;
  private failError: LinearError = { code: 'API_ERROR', message: 'Fake error' };
  private issueCounter = 1;
  private workflowStates: WorkflowState[] = [
    { id: 'state-backlog', name: 'Backlog', type: 'backlog' },
    { id: 'state-progress', name: 'In Progress', type: 'started' },
    { id: 'state-review', name: 'In Review', type: 'started' },
    { id: 'state-qa', name: 'QA', type: 'started' },
  ];

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
      childCount: 0,
      children: [],
      labels: [],
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

  async getIssueByIdentifier(
    _apiKey: string,
    identifier: string
  ): Promise<Result<LinearIssueWithTeam | null, LinearError>> {
    if (this.shouldFail) return err(this.failError);
    const issue = this.issuesWithTeam.find((i) => i.identifier === identifier);
    return ok(issue ?? null);
  }

  async updateIssueState(
    _apiKey: string,
    issueId: string,
    stateId: string
  ): Promise<Result<LinearIssue, LinearError>> {
    if (this.shouldFail) return err(this.failError);

    const issue = this.issues.find((i) => i.id === issueId);
    if (!issue) {
      return err({ code: 'API_ERROR', message: 'Issue not found' });
    }

    // Find the workflow state to get the name
    const workflowState = this.workflowStates.find((s) => s.id === stateId);
    issue.state = {
      id: stateId,
      name: workflowState?.name ?? stateId,
      type: workflowState?.type ?? 'started',
    };
    issue.updatedAt = new Date().toISOString();

    return ok(issue);
  }

  async updateIssue(
    _apiKey: string,
    issueId: string,
    _input: { assigneeId?: string | null; labelIds?: string[]; parentId?: string | null }
  ): Promise<Result<LinearIssue, LinearError>> {
    if (this.shouldFail) return err(this.failError);
    const issue = this.issues.find((i) => i.id === issueId);
    if (!issue) {
      return err({ code: 'API_ERROR', message: 'Issue not found' });
    }
    issue.updatedAt = new Date().toISOString();
    return ok(issue);
  }

  async createComment(
    _apiKey: string,
    _issueId: string,
    _body: string
  ): Promise<Result<{ id: string }, LinearError>> {
    if (this.shouldFail) return err(this.failError);
    return ok({ id: `comment-${Date.now()}` });
  }

  async listIssueLabels(
    _apiKey: string,
    _teamId: string
  ): Promise<Result<{ id: string; name: string; color: string }[], LinearError>> {
    if (this.shouldFail) return err(this.failError);
    return ok([]);
  }

  async getWorkflowStates(
    _apiKey: string,
    _teamId: string
  ): Promise<Result<WorkflowState[], LinearError>> {
    if (this.shouldFail) return err(this.failError);
    return ok(this.workflowStates);
  }

  reset(): void {
    this.issues = [];
    this.issuesWithTeam = [];
    this.shouldFail = false;
    this.issueCounter = 1;
  }

  setTeams(teams: LinearTeam[]): void {
    this.teams = teams;
  }

  seedIssue(issue: LinearIssue): void {
    this.issues.push(issue);
  }

  seedIssueWithTeam(issue: LinearIssueWithTeam): void {
    this.issuesWithTeam.push(issue);
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
  private shouldFailListByUser = false;
  private failError: LinearError = { code: 'INTERNAL_ERROR', message: 'Database error' };
  private shouldFailGetById = false;
  private shouldFailUpdate = false;
  private shouldFailDelete = false;

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
    if (this.shouldFailListByUser) return err(this.failError);
    const userIssues = this.failedIssues.filter((fi) => fi.userId === userId);
    return ok(userIssues);
  }

  async getById(id: string): Promise<Result<FailedLinearIssue, LinearError>> {
    if (this.shouldFailGetById) {
      return err({ code: 'INTERNAL_ERROR', message: 'Failed issue not found' });
    }
    const issue = this.failedIssues.find((fi) => fi.id === id);
    if (!issue) {
      return err({ code: 'INTERNAL_ERROR', message: 'Failed issue not found' });
    }
    return ok(issue);
  }

  async update(
    id: string,
    input: { error: string; lastRetryAt: string }
  ): Promise<Result<void, LinearError>> {
    if (this.shouldFailUpdate) {
      return err({ code: 'INTERNAL_ERROR', message: 'Update failed' });
    }
    const issue = this.failedIssues.find((fi) => fi.id === id);
    if (!issue) {
      return err({ code: 'INTERNAL_ERROR', message: 'Failed issue not found' });
    }
    issue.error = input.error;
    issue.lastRetryAt = input.lastRetryAt;
    return ok(undefined);
  }

  setListByUserFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailListByUser = fail;
    if (error) this.failError = error;
  }

  setGetByIdFailure(fail: boolean): void {
    this.shouldFailGetById = fail;
  }

  setUpdateFailure(fail: boolean): void {
    this.shouldFailUpdate = fail;
  }

  setDeleteFailure(fail: boolean): void {
    this.shouldFailDelete = fail;
  }

  async delete(id: string): Promise<Result<void, LinearError>> {
    if (this.shouldFailDelete) {
      return err({ code: 'INTERNAL_ERROR', message: 'Delete failed' });
    }
    this.failedIssues = this.failedIssues.filter((fi) => fi.id !== id);
    return ok(undefined);
  }

  reset(): void {
    this.failedIssues = [];
    this.counter = 1;
    this.shouldFailListByUser = false;
    this.shouldFailGetById = false;
    this.shouldFailUpdate = false;
    this.shouldFailDelete = false;
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

export class FakeLinearIssueRepository implements LinearIssueRepository {
  /** Storage uses composite key (userId_issueId) to match real Firestore behavior */
  private issues = new Map<string, SyncedLinearIssue>();
  private shouldFail = false;
  private shouldFailSave = false;
  private shouldFailListByUserId = false;
  private shouldFailDeleteById = false;
  private saveFailUserIds = new Set<string>();
  private failError: LinearError = { code: 'INTERNAL_ERROR', message: 'Database error' };

  private compositeKey(userId: string, issueId: string): string {
    return `${userId}_${issueId}`;
  }

  async save(issue: SyncedLinearIssue): Promise<Result<SyncedLinearIssue, LinearError>> {
    if (this.shouldFail || this.shouldFailSave) return err(this.failError);
    if (this.saveFailUserIds.has(issue.userId)) return err(this.failError);
    this.issues.set(this.compositeKey(issue.userId, issue.id), { ...issue });
    return ok(issue);
  }

  async findById(id: string): Promise<Result<SyncedLinearIssue | null, LinearError>> {
    if (this.shouldFail) return err(this.failError);
    for (const issue of this.issues.values()) {
      if (issue.id === id) return ok(issue);
    }
    return ok(null);
  }

  async findByIdentifier(identifier: string, userId?: string): Promise<Result<SyncedLinearIssue | null, LinearError>> {
    if (this.shouldFail) return err(this.failError);
    for (const issue of this.issues.values()) {
      if (issue.identifier === identifier) {
        if (userId !== undefined && issue.userId !== userId) continue;
        return ok(issue);
      }
    }
    return ok(null);
  }

  async listByUserId(userId: string): Promise<Result<SyncedLinearIssue[], LinearError>> {
    if (this.shouldFail || this.shouldFailListByUserId) return err(this.failError);
    const userIssues = Array.from(this.issues.values()).filter((i) => i.userId === userId);
    return ok(userIssues);
  }

  async deleteById(id: string, userId: string): Promise<Result<void, LinearError>> {
    if (this.shouldFail || this.shouldFailDeleteById) return err(this.failError);
    this.issues.delete(this.compositeKey(userId, id));
    return ok(undefined);
  }

  async findUserIdsByIssueId(issueId: string): Promise<Result<string[], LinearError>> {
    if (this.shouldFail) return err(this.failError);
    const userIds: string[] = [];
    for (const issue of this.issues.values()) {
      if (issue.id === issueId) {
        userIds.push(issue.userId);
      }
    }
    return ok(userIds);
  }

  setFailure(fail: boolean, error?: LinearError): void {
    this.shouldFail = fail;
    if (error) this.failError = error;
  }

  setSaveFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailSave = fail;
    if (error) this.failError = error;
  }

  setListByUserIdFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailListByUserId = fail;
    if (error) this.failError = error;
  }

  setDeleteFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailDeleteById = fail;
    if (error) this.failError = error;
  }

  /** Make save fail only for specific userIds (for partial fan-out failure testing) */
  setSaveFailureForUsers(userIds: string[]): void {
    for (const uid of userIds) {
      this.saveFailUserIds.add(uid);
    }
  }

  reset(): void {
    this.issues.clear();
    this.shouldFail = false;
    this.shouldFailSave = false;
    this.shouldFailListByUserId = false;
    this.shouldFailDeleteById = false;
    this.saveFailUserIds.clear();
  }

  seedIssue(issue: SyncedLinearIssue): void {
    this.issues.set(this.compositeKey(issue.userId, issue.id), issue);
  }

  get count(): number {
    return this.issues.size;
  }
}

export class FakeLlmGenerateClient implements LlmGenerateClient {
  private content = '{"title": "Generated title", "issueType": "feature"}';
  private shouldFail = false;
  private failError: LLMError = { code: 'API_ERROR', message: 'LLM error' };
  private responseSequence: Result<GenerateResult, LLMError>[] | null = null;
  private sequenceIndex = 0;

  async generate(_prompt: string): Promise<Result<GenerateResult, LLMError>> {
    if (this.responseSequence !== null) {
      const index = Math.min(this.sequenceIndex, this.responseSequence.length - 1);
      this.sequenceIndex++;
      return this.responseSequence[index] as Result<GenerateResult, LLMError>;
    }
    if (this.shouldFail) return err(this.failError);
    return ok({
      content: this.content,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.001 },
    });
  }

  setContent(content: string): void {
    this.content = content;
  }

  setFailure(fail: boolean, error?: { code: LLMErrorCode; message: string }): void {
    this.shouldFail = fail;
    if (error !== undefined) {
      this.failError = { code: error.code, message: error.message };
    }
  }

  setResponseSequence(responses: Result<GenerateResult, LLMError>[]): void {
    this.responseSequence = responses;
    this.sequenceIndex = 0;
  }

  reset(): void {
    this.content = '{"title": "Generated title", "issueType": "feature"}';
    this.shouldFail = false;
    this.responseSequence = null;
    this.sequenceIndex = 0;
  }
}

export class FakeUserServiceClient implements UserServiceClient {
  private llmClient: LlmGenerateClient = new FakeLlmGenerateClient();
  private shouldFail = false;
  private failError: UserServiceError = { code: 'API_ERROR', message: 'User service error' };

  async getApiKeys(_userId: string): Promise<Result<{ google?: string; openai?: string; anthropic?: string; perplexity?: string; zai?: string }, UserServiceError>> {
    if (this.shouldFail) return err(this.failError);
    return ok({ google: 'fake-google-key', openai: 'fake-openai-key' });
  }

  async getLlmClient(_userId: string): Promise<Result<LlmGenerateClient, UserServiceError>> {
    if (this.shouldFail) return err(this.failError);
    return ok(this.llmClient);
  }

  async reportLlmSuccess(_userId: string, _provider: string): Promise<void> {
    return;
  }

  async getOAuthToken(_userId: string, _provider: string): Promise<Result<{ accessToken: string; email: string }, UserServiceError>> {
    if (this.shouldFail) return err(this.failError);
    return ok({ accessToken: 'fake-token', email: 'test@example.com' });
  }

  setLlmClient(client: LlmGenerateClient): void {
    this.llmClient = client;
  }

  setFailure(fail: boolean, error?: UserServiceError): void {
    this.shouldFail = fail;
    if (error !== undefined) this.failError = error;
  }

  async resolveGitHubUsername(): Promise<Result<{ userId: string } | null, UserServiceError>> {
    return ok(null);
  }

  reset(): void {
    this.llmClient = new FakeLlmGenerateClient();
    this.shouldFail = false;
  }
}

export class FakeLinearCommentRepository implements LinearCommentRepository {
  private comments = new Map<string, LinearComment>();
  private shouldFail = false;
  private shouldFailSave = false;
  private shouldFailListByIssueId = false;
  private shouldFailCountByIssueId = false;
  private shouldFailDeleteById = false;
  private failError: LinearError = { code: 'INTERNAL_ERROR', message: 'Database error' };

  async save(comment: LinearComment): Promise<Result<LinearComment, LinearError>> {
    if (this.shouldFail || this.shouldFailSave) return err(this.failError);
    this.comments.set(comment.id, { ...comment });
    return ok(comment);
  }

  async findById(id: string): Promise<Result<LinearComment | null, LinearError>> {
    if (this.shouldFail) return err(this.failError);
    return ok(this.comments.get(id) ?? null);
  }

  async listByIssueId(issueId: string): Promise<Result<LinearComment[], LinearError>> {
    if (this.shouldFail || this.shouldFailListByIssueId) return err(this.failError);
    const issueComments = Array.from(this.comments.values())
      .filter((c) => c.issueId === issueId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return ok(issueComments);
  }

  async countByIssueId(issueId: string): Promise<Result<number, LinearError>> {
    if (this.shouldFail || this.shouldFailCountByIssueId) return err(this.failError);
    const count = Array.from(this.comments.values()).filter((c) => c.issueId === issueId).length;
    return ok(count);
  }

  async deleteById(id: string): Promise<Result<void, LinearError>> {
    if (this.shouldFail || this.shouldFailDeleteById) return err(this.failError);
    this.comments.delete(id);
    return ok(undefined);
  }

  setFailure(fail: boolean, error?: LinearError): void {
    this.shouldFail = fail;
    if (error) this.failError = error;
  }

  setSaveFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailSave = fail;
    if (error) this.failError = error;
  }

  setListByIssueIdFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailListByIssueId = fail;
    if (error) this.failError = error;
  }

  setCountByIssueIdFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailCountByIssueId = fail;
    if (error) this.failError = error;
  }

  setDeleteByIdFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailDeleteById = fail;
    if (error) this.failError = error;
  }

  reset(): void {
    this.comments.clear();
    this.shouldFail = false;
    this.shouldFailSave = false;
    this.shouldFailListByIssueId = false;
    this.shouldFailCountByIssueId = false;
    this.shouldFailDeleteById = false;
  }
}

export class FakeCodeAgentClient implements CodeAgentClient {
  private shouldFail = false;
  private failError: CodeAgentError = { code: 'UNAVAILABLE', message: 'code-agent unavailable' };
  private lastRequest: { userId: string; linearIssueId: string; prompt: string; workerType: string; actionId: string; approvalEventId: string } | null = null;
  private taskIdCounter = 1;

  async triggerCodeTask(request: {
    userId: string;
    linearIssueId: string;
    prompt: string;
    workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm';
    actionId: string;
    approvalEventId: string;
  }): Promise<Result<TriggerCodeTaskResponse, CodeAgentError>> {
    this.lastRequest = {
      userId: request.userId,
      linearIssueId: request.linearIssueId,
      prompt: request.prompt,
      workerType: request.workerType,
      actionId: request.actionId,
      approvalEventId: request.approvalEventId,
    };

    if (this.shouldFail) return err(this.failError);

    return ok({ codeTaskId: `code-task-${this.taskIdCounter++}` });
  }

  setFailure(fail: boolean, error?: CodeAgentError): void {
    this.shouldFail = fail;
    if (error) this.failError = error;
  }

  getLastRequest(): typeof this.lastRequest {
    return this.lastRequest;
  }

  reset(): void {
    this.shouldFail = false;
    this.lastRequest = null;
    this.taskIdCounter = 1;
  }
}
