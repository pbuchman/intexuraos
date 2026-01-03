/**
 * Tests for unshareResearch use case.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import {
  unshareResearch,
  type UnshareResearchDeps,
} from '../../../../domain/research/usecases/unshareResearch.js';
import type { Research } from '../../../../domain/research/models/index.js';

function createMockDeps(): UnshareResearchDeps & {
  mockRepo: { findById: ReturnType<typeof vi.fn>; clearShareInfo: ReturnType<typeof vi.fn> };
  mockShareStorage: { delete: ReturnType<typeof vi.fn> };
} {
  const mockRepo = {
    findById: vi.fn(),
    save: vi.fn(),
    update: vi.fn().mockResolvedValue(ok({})),
    updateLlmResult: vi.fn(),
    findByUserId: vi.fn(),
    clearShareInfo: vi.fn().mockResolvedValue(ok({})),
    delete: vi.fn(),
  };

  const mockShareStorage = {
    upload: vi.fn(),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
  };

  return {
    researchRepo: mockRepo,
    shareStorage: mockShareStorage,
    mockRepo,
    mockShareStorage,
  };
}

function createTestResearchBase(): Omit<Research, 'shareInfo'> {
  return {
    id: 'research-1',
    userId: 'user-1',
    title: 'Test Research',
    prompt: 'Test prompt',
    status: 'completed',
    selectedModels: ['gemini-2.5-pro'],
    synthesisModel: 'gemini-2.5-pro',
    llmResults: [],
    startedAt: '2024-01-01T10:00:00Z',
  };
}

function createTestResearch(overrides: Partial<Research> = {}): Research {
  return {
    ...createTestResearchBase(),
    shareInfo: {
      shareToken: 'abc123',
      slug: 'test-research',
      shareUrl: 'https://example.com/share/test.html',
      sharedAt: '2024-01-01T12:00:00Z',
      gcsPath: 'research/abc123-test-research.html',
    },
    ...overrides,
  } as Research;
}

function createTestResearchWithoutShare(overrides: Partial<Research> = {}): Research {
  return {
    ...createTestResearchBase(),
    ...overrides,
  } as Research;
}

describe('unshareResearch', () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when research not found', async () => {
    deps.mockRepo.findById.mockResolvedValue(ok(null));

    const result = await unshareResearch('nonexistent', 'user-1', deps);

    expect(result).toEqual({ ok: false, error: 'Research not found' });
  });

  it('returns error when repository findById fails', async () => {
    deps.mockRepo.findById.mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'DB error' }));

    const result = await unshareResearch('research-1', 'user-1', deps);

    expect(result).toEqual({ ok: false, error: 'Research not found' });
  });

  it('returns error when user does not own research', async () => {
    const research = createTestResearch({ userId: 'other-user' });
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await unshareResearch('research-1', 'user-1', deps);

    expect(result).toEqual({ ok: false, error: 'Access denied' });
  });

  it('returns error when research is not shared', async () => {
    const research = createTestResearchWithoutShare();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await unshareResearch('research-1', 'user-1', deps);

    expect(result).toEqual({ ok: false, error: 'Research is not shared' });
  });

  it('deletes from GCS and updates research', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await unshareResearch('research-1', 'user-1', deps);

    expect(result).toEqual({ ok: true });
    expect(deps.mockShareStorage.delete).toHaveBeenCalledWith('research/abc123-test-research.html');
    expect(deps.mockRepo.clearShareInfo).toHaveBeenCalledWith('research-1');
  });

  it('works when shareStorage is null', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));

    const result = await unshareResearch('research-1', 'user-1', {
      researchRepo: deps.researchRepo,
      shareStorage: null,
    });

    expect(result).toEqual({ ok: true });
    expect(deps.mockRepo.clearShareInfo).toHaveBeenCalledWith('research-1');
  });

  it('returns error when GCS delete fails', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockShareStorage.delete.mockResolvedValue(
      err({ code: 'STORAGE_ERROR' as const, message: 'Delete failed' })
    );

    const result = await unshareResearch('research-1', 'user-1', deps);

    expect(result).toEqual({ ok: false, error: 'Delete failed' });
    expect(deps.mockRepo.clearShareInfo).not.toHaveBeenCalled();
  });

  it('returns error when clearShareInfo fails', async () => {
    const research = createTestResearch();
    deps.mockRepo.findById.mockResolvedValue(ok(research));
    deps.mockRepo.clearShareInfo.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'Update failed' })
    );

    const result = await unshareResearch('research-1', 'user-1', deps);

    expect(result).toEqual({ ok: false, error: 'Failed to update research' });
  });
});
