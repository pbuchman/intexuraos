/**
 * Test fakes for linear-agent.
 */

import { err, ok, type Result, type CodeTaskWorkerType } from '@intexuraos/common-core';
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
  CommentSummary,
  PruneCandidateRepository,
  StoredPruneCandidate,
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
  private shouldReturnNullForGetFullConnection = false;
  private shouldFailGetConnection = false;
  private shouldFailFindWebhookSecret = false;
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

  private shouldFailGetApiKey = false;

  async getApiKey(userId: string): Promise<Result<string | null, LinearError>> {
    if (this.shouldFailGetApiKey) return err(this.failError);
    const conn = this.connections.get(userId);
    if (!conn || !conn.connected) return ok(null);
    return ok(conn.apiKey);
  }

  setApiKeyFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailGetApiKey = fail;
    if (error) this.failError = error;
  }

  async getFullConnection(userId: string): Promise<Result<LinearConnection | null, LinearError>> {
    if (this.shouldFailGetFullConnection) return err(this.failError);
    if (this.shouldReturnNullForGetFullConnection) return ok(null);
    const conn = this.connections.get(userId);
    if (!conn || !conn.connected) return ok(null);
    return ok(conn);
  }

  setGetFullConnectionFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailGetFullConnection = fail;
    if (error) this.failError = error;
  }

  setGetFullConnectionReturnsNull(returnsNull: boolean): void {
    this.shouldReturnNullForGetFullConnection = returnsNull;
  }

  setGetConnectionFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailGetConnection = fail;
    if (error) this.failError = error;
  }

  setFindWebhookSecretFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailFindWebhookSecret = fail;
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
    if (this.shouldFailFindWebhookSecret) return err(this.failError);
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
    this.shouldReturnNullForGetFullConnection = false;
    this.shouldFailGetConnection = false;
    this.shouldFailFindWebhookSecret = false;
    this.shouldFailGetApiKey = false;
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
    { id: 'state-done', name: 'Done', type: 'completed' },
  ];
  private labels: { id: string; name: string; color: string }[] = [];

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

  async getDirectChildren(
    _apiKey: string,
    issueId: string
  ): Promise<Result<LinearIssue[] | null, LinearError>> {
    if (this.shouldFail) return err(this.failError);
    const issue = this.issues.find((i) => i.id === issueId);
    if (!issue) {
      return ok(null);
    }
    return ok(issue.children);
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
    // Apply labelIds from input to issue.labels (this is needed for label mutation tests)
    if (_input.labelIds !== undefined) {
      issue.labels = _input.labelIds
        .map((id) => {
          const label = this.labels.find((l) => l.id === id);
          return label ? { id: label.id, name: label.name, color: label.color } : null;
        })
        .filter((l): l is { id: string; name: string; color: string } => l !== null);
    }
    // Note: We intentionally do NOT set assignee or parentId here.
    // The real Linear API updateIssue doesn't necessarily return the full issue object,
    // and tests verify the ?? null fallback for assignee handling.
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
    return ok(this.labels);
  }

  async getWorkflowStates(
    _apiKey: string,
    _teamId: string
  ): Promise<Result<WorkflowState[], LinearError>> {
    if (this.shouldFail) return err(this.failError);
    return ok(this.workflowStates);
  }

  async deleteIssue(
    _apiKey: string,
    _issueId: string
  ): Promise<Result<void, LinearError>> {
    if (this.shouldFail) return err(this.failError);
    return ok(undefined);
  }

  reset(): void {
    this.issues = [];
    this.issuesWithTeam = [];
    this.shouldFail = false;
    this.issueCounter = 1;
    this.labels = [];
  }

  setTeams(teams: LinearTeam[]): void {
    this.teams = teams;
  }

  setLabels(labels: { id: string; name: string; color: string }[]): void {
    this.labels = labels;
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
  private shouldFailCreate = false;
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
    if (this.shouldFailCreate) return err(this.failError);
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

  setCreateFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailCreate = fail;
    if (error) this.failError = error;
  }

  seedFailedIssue(issue: FailedLinearIssue): void {
    this.failedIssues.push(issue);
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
    this.shouldFailCreate = false;
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

  private shouldFailFindByIdentifier = false;

  async findByIdentifier(identifier: string, userId?: string): Promise<Result<SyncedLinearIssue | null, LinearError>> {
    if (this.shouldFail || this.shouldFailFindByIdentifier) return err(this.failError);
    for (const issue of this.issues.values()) {
      if (issue.identifier === identifier) {
        if (userId !== undefined && issue.userId !== userId) continue;
        return ok(issue);
      }
    }
    return ok(null);
  }

  setFindByIdentifierFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailFindByIdentifier = fail;
    if (error) this.failError = error;
  }

  private shouldFailFindByIdentifiers = false;

  async findByIdentifiers(identifiers: string[], userId: string): Promise<Result<SyncedLinearIssue[], LinearError>> {
    if (this.shouldFail || this.shouldFailFindByIdentifiers) return err(this.failError);
    const identifierSet = new Set(identifiers);
    const matched: SyncedLinearIssue[] = [];
    for (const issue of this.issues.values()) {
      if (issue.userId === userId && identifierSet.has(issue.identifier)) {
        matched.push(issue);
      }
    }
    return ok(matched);
  }

  setFindByIdentifiersFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailFindByIdentifiers = fail;
    if (error) this.failError = error;
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

  private findUserIdsByIssueIdOverride: Result<string[], LinearError> | null = null;

  async findUserIdsByIssueId(issueId: string): Promise<Result<string[], LinearError>> {
    if (this.shouldFail) return err(this.failError);
    if (this.findUserIdsByIssueIdOverride !== null) return this.findUserIdsByIssueIdOverride;
    const userIds: string[] = [];
    for (const issue of this.issues.values()) {
      if (issue.id === issueId) {
        userIds.push(issue.userId);
      }
    }
    return ok(userIds);
  }

  setFindUserIdsByIssueIdOverride(result: Result<string[], LinearError> | null): void {
    this.findUserIdsByIssueIdOverride = result;
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
    this.shouldFailFindByIdentifier = false;
    this.shouldFailFindByIdentifiers = false;
    this.saveFailUserIds.clear();
    this.findUserIdsByIssueIdOverride = null;
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

  async getUserTimezone(): Promise<string | undefined> {
    return undefined;
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

  private shouldFailGetCommentSummaries = false;

  async getCommentSummaries(issueIds: string[]): Promise<Result<CommentSummary[], LinearError>> {
    if (this.shouldFail || this.shouldFailGetCommentSummaries) return err(this.failError);
    const issueIdSet = new Set(issueIds);
    const summaryMap = new Map<string, { count: number; lastCommentAt: string | null }>();
    for (const comment of this.comments.values()) {
      if (!issueIdSet.has(comment.issueId)) continue;
      const existing = summaryMap.get(comment.issueId);
      if (existing === undefined) {
        summaryMap.set(comment.issueId, { count: 1, lastCommentAt: comment.createdAt });
      } else {
        existing.count++;
        if (existing.lastCommentAt === null || comment.createdAt > existing.lastCommentAt) {
          existing.lastCommentAt = comment.createdAt;
        }
      }
    }
    const summaries: CommentSummary[] = issueIds.map((issueId) => {
      const entry = summaryMap.get(issueId);
      return {
        issueId,
        commentCount: entry?.count ?? 0,
        lastCommentAt: entry?.lastCommentAt ?? null,
      };
    });
    return ok(summaries);
  }

  setGetCommentSummariesFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailGetCommentSummaries = fail;
    if (error) this.failError = error;
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
    this.shouldFailGetCommentSummaries = false;
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
    workerType: CodeTaskWorkerType;
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

  async notifyGroupSummaryRecompute(_request: {
    userId: string;
    linearIssueId: string;
    labels: { id: string; name: string }[];
    sourceTimestamp: string;
  }): Promise<Result<void, CodeAgentError>> {
    return ok(undefined);
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

export class FakePruneCandidateRepository implements PruneCandidateRepository {
  private candidates: StoredPruneCandidate[] = [];
  private shouldFailListAll = false;
  private failError: LinearError = { code: 'INTERNAL_ERROR', message: 'Database error' };

  async clearAll(): Promise<Result<void, LinearError>> {
    this.candidates = [];
    return ok(undefined);
  }

  async storeAll(candidates: StoredPruneCandidate[]): Promise<Result<void, LinearError>> {
    this.candidates = [...candidates];
    return ok(undefined);
  }

  async listAll(): Promise<Result<StoredPruneCandidate[], LinearError>> {
    if (this.shouldFailListAll) return err(this.failError);
    const sorted = [...this.candidates].sort((a, b) => b.score - a.score);
    return ok(sorted);
  }

  setListAllFailure(fail: boolean, error?: LinearError): void {
    this.shouldFailListAll = fail;
    if (error) this.failError = error;
  }

  reset(): void {
    this.candidates = [];
    this.shouldFailListAll = false;
  }

  seedCandidates(candidates: StoredPruneCandidate[]): void {
    this.candidates = [...candidates];
  }

  getCandidates(): StoredPruneCandidate[] {
    return [...this.candidates];
  }
}
