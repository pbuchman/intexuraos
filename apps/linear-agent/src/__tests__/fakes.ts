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
} from '../domain/index.js';

export class FakeLinearConnectionRepository implements LinearConnectionRepository {
  private connections = new Map<string, LinearConnection>();

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
    const conn = this.connections.get(userId);
    if (!conn || !conn.connected) return ok(null);
    return ok(conn);
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
    apiKey: string,
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
    apiKey: string,
    teamId: string,
    options?: { completedSinceDays?: number }
  ): Promise<Result<LinearIssue[], LinearError>> {
    if (this.shouldFail) return err(this.failError);
    return ok(this.issues);
  }

  async getIssue(
    apiKey: string,
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
