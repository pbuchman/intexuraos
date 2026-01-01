/**
 * Fake implementations for testing.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  LlmProvider,
  LlmResult,
  RepositoryError,
  Research,
  ResearchRepository,
} from '../domain/research/index.js';
import type { DecryptedApiKeys, UserServiceClient } from '../infra/user/index.js';

/**
 * In-memory fake implementation of ResearchRepository.
 */
export class FakeResearchRepository implements ResearchRepository {
  private researches: Map<string, Research> = new Map();
  private failNextSave = false;
  private failNextFind = false;
  private failNextDelete = false;
  private failNextUpdate = false;

  async save(research: Research): Promise<Result<Research, RepositoryError>> {
    if (this.failNextSave) {
      this.failNextSave = false;
      return err({ code: 'FIRESTORE_ERROR', message: 'Test save failure' });
    }
    this.researches.set(research.id, research);
    return ok(research);
  }

  async findById(id: string): Promise<Result<Research | null, RepositoryError>> {
    if (this.failNextFind) {
      this.failNextFind = false;
      return err({ code: 'FIRESTORE_ERROR', message: 'Test find failure' });
    }
    const research = this.researches.get(id) ?? null;
    return ok(research);
  }

  async findByUserId(
    userId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<Result<{ items: Research[]; nextCursor?: string }, RepositoryError>> {
    if (this.failNextFind) {
      this.failNextFind = false;
      return err({ code: 'FIRESTORE_ERROR', message: 'Test find failure' });
    }

    const limit = options?.limit ?? 50;
    const items = Array.from(this.researches.values())
      .filter((r) => r.userId === userId)
      .slice(0, limit);

    return ok({ items });
  }

  async update(id: string, updates: Partial<Research>): Promise<Result<Research, RepositoryError>> {
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      return err({ code: 'FIRESTORE_ERROR', message: 'Test update failure' });
    }
    const existing = this.researches.get(id);
    if (existing === undefined) {
      return err({ code: 'NOT_FOUND', message: 'Research not found' });
    }
    const updated = { ...existing, ...updates };
    this.researches.set(id, updated);
    return ok(updated);
  }

  async updateLlmResult(
    researchId: string,
    provider: LlmProvider,
    result: Partial<LlmResult>
  ): Promise<Result<void, RepositoryError>> {
    const existing = this.researches.get(researchId);
    if (existing === undefined) {
      return err({ code: 'NOT_FOUND', message: 'Research not found' });
    }
    const llmIndex = existing.llmResults.findIndex((r) => r.provider === provider);
    if (llmIndex >= 0) {
      const llmResult = existing.llmResults[llmIndex];
      if (llmResult !== undefined) {
        existing.llmResults[llmIndex] = { ...llmResult, ...result };
      }
    }
    this.researches.set(researchId, existing);
    return ok(undefined);
  }

  async delete(id: string): Promise<Result<void, RepositoryError>> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      return err({ code: 'FIRESTORE_ERROR', message: 'Test delete failure' });
    }
    this.researches.delete(id);
    return ok(undefined);
  }

  // Test helpers
  setFailNextSave(fail: boolean): void {
    this.failNextSave = fail;
  }

  setFailNextFind(fail: boolean): void {
    this.failNextFind = fail;
  }

  setFailNextDelete(fail: boolean): void {
    this.failNextDelete = fail;
  }

  setFailNextUpdate(fail: boolean): void {
    this.failNextUpdate = fail;
  }

  addResearch(research: Research): void {
    this.researches.set(research.id, research);
  }

  getAll(): Research[] {
    return Array.from(this.researches.values());
  }

  clear(): void {
    this.researches.clear();
  }
}

/**
 * Fake implementation of UserServiceClient for testing.
 */
export class FakeUserServiceClient implements UserServiceClient {
  private apiKeys: Map<string, DecryptedApiKeys> = new Map();
  private phones: Map<string, string> = new Map();
  private failNextGetApiKeys = false;

  async getApiKeys(userId: string): Promise<Result<DecryptedApiKeys, Error>> {
    if (this.failNextGetApiKeys) {
      this.failNextGetApiKeys = false;
      return err(new Error('Test getApiKeys failure'));
    }
    const keys = this.apiKeys.get(userId) ?? {};
    return ok(keys);
  }

  async getWhatsAppPhone(userId: string): Promise<Result<string | null, Error>> {
    const phone = this.phones.get(userId) ?? null;
    return ok(phone);
  }

  async reportLlmSuccess(_userId: string, _provider: LlmProvider): Promise<Result<void, Error>> {
    return ok(undefined);
  }

  // Test helpers
  setApiKeys(userId: string, keys: DecryptedApiKeys): void {
    this.apiKeys.set(userId, keys);
  }

  setPhone(userId: string, phone: string): void {
    this.phones.set(userId, phone);
  }

  setFailNextGetApiKeys(fail: boolean): void {
    this.failNextGetApiKeys = fail;
  }

  clear(): void {
    this.apiKeys.clear();
    this.phones.clear();
  }
}
