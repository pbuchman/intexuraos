import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from '@google-cloud/firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { Logger } from '@intexuraos/common-core';

import { createFirestoreCodeTaskRepository } from '../../../infra/repositories/firestoreCodeTaskRepository.js';

describe('firestoreCodeTaskRepository execution memory queries', () => {
  const logger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  it('lists memory-eligible tasks pending post-run memory processing oldest-first', async () => {
    const docs = [
      {
        id: 'task-1',
        data: (): Record<string, unknown> => ({
          userId: 'user-123',
          prompt: 'first',
          sanitizedPrompt: 'first',
          systemPromptHash: 'abc123',
          workerType: 'opus',
          workerLocation: 'vm',
          repository: 'test/repo',
          baseBranch: 'development',
          traceId: 'trace-1',
          status: 'implemented',
          dedupKey: 'dedup-1',
          callbackReceived: true,
          agentType: 'execution',
          createdAt: Timestamp.fromDate(new Date('2025-03-25T09:00:00Z')),
          updatedAt: Timestamp.fromDate(new Date('2025-03-25T10:00:00Z')),
          completedAt: Timestamp.fromDate(new Date('2025-03-25T10:00:00Z')),
          executionMemoryPostRun: { status: 'pending', attempts: 0, generatedMemoryIds: [] },
        }),
      },
      {
        id: 'task-2',
        data: (): Record<string, unknown> => ({
          userId: 'user-123',
          prompt: 'second',
          sanitizedPrompt: 'second',
          systemPromptHash: 'abc123',
          workerType: 'opus',
          workerLocation: 'vm',
          repository: 'test/repo',
          baseBranch: 'development',
          traceId: 'trace-2',
          status: 'implemented',
          dedupKey: 'dedup-2',
          callbackReceived: true,
          agentType: 'execution',
          createdAt: Timestamp.fromDate(new Date('2025-03-25T09:30:00Z')),
          updatedAt: Timestamp.fromDate(new Date('2025-03-25T11:00:00Z')),
          completedAt: Timestamp.fromDate(new Date('2025-03-25T11:00:00Z')),
          executionMemoryPostRun: { status: 'pending', attempts: 0, generatedMemoryIds: [] },
        }),
      },
    ];

    const get = vi.fn().mockResolvedValue({ docs });
    const limit = vi.fn().mockReturnValue({ get });
    const orderBy = vi.fn().mockReturnValue({ limit });
    const wherePending = vi.fn().mockReturnValue({ orderBy });
    const whereAgentType = vi.fn().mockReturnValue({ where: wherePending });

    const firestore = {
      collection: vi.fn().mockReturnValue({
        where: whereAgentType,
      }),
    } as unknown as Firestore;

    const repo = createFirestoreCodeTaskRepository({ firestore, logger });

    const result = await repo.listPendingExecutionMemoryPostRun(10);

    if (!result.ok) throw new Error(`Expected ok result, got: ${result.error.message}`);

    expect(whereAgentType).toHaveBeenCalledWith('agentType', 'in', ['execution', 'planning', 'review']);
    expect(wherePending).toHaveBeenCalledWith('executionMemoryPostRun.status', '==', 'pending');
    expect(orderBy).toHaveBeenCalledWith('completedAt', 'asc');
    expect(limit).toHaveBeenCalledWith(10);
    expect(result.value.map((task) => task.id)).toEqual(['task-1', 'task-2']);
  });
});
