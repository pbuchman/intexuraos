/**
 * Test helpers for mocking Firestore.
 * Provides in-memory fakes for Firestore operations.
 */

import { Timestamp } from '@google-cloud/firestore';
import { vi } from 'vitest';
import type { CodeTask, TaskStatus } from '../../domain/models/codeTask.js';

/**
 * Create a fake CodeTask for testing
 */
export function createFakeTask(overrides: Partial<CodeTask> = {}): CodeTask {
  const now = Timestamp.fromDate(new Date());
  return {
    id: `task_${crypto.randomUUID()}`,
    userId: 'user123',
    prompt: 'Test prompt',
    sanitizedPrompt: 'Test prompt',
    systemPromptHash: 'abc123',
    workerType: 'opus',
    workerLocation: 'vm',
    repository: 'test/repo',
    baseBranch: 'main',
    traceId: 'trace-123',
    status: 'dispatched' as TaskStatus,
    dedupKey: 'dedup123',
    callbackReceived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a fake DocumentSnapshot
 */
export function createFakeDocSnapshot<T>(data: T, id: string): unknown {
  return {
    id,
    exists: true,
    data: () => data,
    get: (field: string) => {
      const obj = data as Record<string, unknown>;
      return obj[field];
    },
  } as unknown;
}

/**
 * Create a fake QuerySnapshot
 */
export function createFakeQuerySnapshot<T>(docs: { data: T; id: string }[]): unknown {
  return {
    empty: docs.length === 0,
    docs: docs.map((doc) =>
      createFakeDocSnapshot(doc.data, doc.id)
    ) as unknown[],
    forEach: (callback: (doc: unknown) => void) => {
      docs.forEach((doc) => callback(createFakeDocSnapshot(doc.data, doc.id)));
    },
  } as unknown;
}

/**
 * Mock Firestore transaction
 */
export function createFakeTransaction(): unknown {
  return {
    get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    create: vi.fn(),
  };
}

/**
 * Setup common Firestore mocks
 */
export function setupFirestoreMocks(): Record<string, unknown> {
  const collection = vi.fn();
  const doc = vi.fn();
  const where = vi.fn();
  const orderBy = vi.fn();
  const limit = vi.fn();
  const startAfter = vi.fn();
  const get = vi.fn();
  const set = vi.fn();
  const update = vi.fn();
  const runTransaction = vi.fn();

  // Chainable query builder
  const mockQuery = {
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    startAfter: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
  };

  collection.mockReturnValue({
    doc,
    where: vi.fn(() => mockQuery),
    orderBy: vi.fn(() => mockQuery),
    limit: vi.fn(() => mockQuery),
    get,
  });

  doc.mockReturnValue({
    get,
    set,
    update,
    delete: vi.fn(),
  });

  return {
    collection,
    doc,
    where,
    orderBy,
    limit,
    startAfter,
    get,
    set,
    update,
    runTransaction,
    mockQuery,
  };
}
