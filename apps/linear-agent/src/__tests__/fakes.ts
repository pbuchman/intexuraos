/**
 * Test fakes for linear-agent.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  LinearConnectionRepository,
  LinearConnection,
  LinearConnectionPublic,
  LinearError,
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
