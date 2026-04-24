import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import { fetchBacklog } from '../../../../domain/usecases/executionMemory/fetchBacklog.js';
import type { CodeTask } from '../../../../domain/models/codeTask.js';

function makeTask(id: string): CodeTask {
  const now = Timestamp.now();
  return {
    id,
    userId: 'user-1',
    prompt: 'prompt',
    sanitizedPrompt: 'prompt',
    systemPromptHash: 'h',
    workerType: 'auto',
    workerLocation: 'loc',
    repository: 'pbuchman/test',
    baseBranch: 'main',
    status: 'implemented',
    traceId: 't',
    dedupKey: 'd',
    createdAt: now,
    updatedAt: now,
  } as CodeTask;
}

describe('fetchBacklog', () => {
  it('returns empty array when backlog is empty', async () => {
    const listFn = vi.fn().mockResolvedValue(ok([]));

    const result = await fetchBacklog({
      codeTaskRepo: { listPendingExecutionMemoryPostRun: listFn },
      limit: 5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
    expect(listFn).toHaveBeenCalledWith(5);
  });

  it('returns backlog entries from the repository', async () => {
    const tasks = [makeTask('task-a'), makeTask('task-b')];
    const listFn = vi.fn().mockResolvedValue(ok(tasks));

    const result = await fetchBacklog({
      codeTaskRepo: { listPendingExecutionMemoryPostRun: listFn },
      limit: 10,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(tasks);
      expect(result.value).toHaveLength(2);
      expect(result.value[0]?.id).toBe('task-a');
      expect(result.value[1]?.id).toBe('task-b');
    }
    expect(listFn).toHaveBeenCalledWith(10);
  });

  it('propagates repo errors as { code: "internal_error", message }', async () => {
    const listFn = vi.fn().mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'connection refused' })
    );

    const result = await fetchBacklog({
      codeTaskRepo: { listPendingExecutionMemoryPostRun: listFn },
      limit: 3,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
      expect(result.error.message).toBe('connection refused');
    }
  });
});
