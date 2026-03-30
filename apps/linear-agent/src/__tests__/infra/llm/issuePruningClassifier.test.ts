import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createIssuePruningClassifier } from '../../../infra/llm/issuePruningClassifier.js';
import type { IssuePruningClassifier, SyncedLinearIssue } from '../../../domain/index.js';
import type { Logger } from 'pino';
import type { Result } from '@intexuraos/common-core';

function createFakeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function createTestIssue(overrides: Partial<SyncedLinearIssue>): SyncedLinearIssue {
  return {
    id: 'test-id',
    identifier: 'INT-100',
    title: 'Test issue',
    description: 'Test description',
    state: 'Done',
    stateType: 'completed',
    priority: 0,
    assigneeId: null,
    assigneeName: null,
    labels: [],
    url: 'https://linear.app/test',
    userId: 'user-1',
    parentId: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    syncedAt: '2026-03-29T00:00:00.000Z',
    teamId: 'team-1',
    ...overrides,
  };
}

describe('IssuePruningClassifier', () => {
  let classifier: IssuePruningClassifier;
  let fakeGenerate: ReturnType<typeof vi.fn>;
  let logger: Logger;

  beforeEach(() => {
    logger = createFakeLogger();
    fakeGenerate = vi.fn();
    classifier = createIssuePruningClassifier({
      generate: fakeGenerate as unknown as (prompt: string) => Promise<Result<{ content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }, { code: string; message: string }>>,
      logger,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns scored candidates from Gemini response', async () => {
    const issues = [
      createTestIssue({ id: '1', identifier: 'INT-100', title: 'Cancelled task', stateType: 'cancelled', state: 'Canceled' }),
      createTestIssue({ id: '2', identifier: 'INT-200', title: 'Active task', stateType: 'started', state: 'In Progress' }),
      createTestIssue({ id: '3', identifier: 'INT-300', title: 'Sub-issue fix', stateType: 'completed', state: 'Done', parentId: 'parent-1' }),
    ];

    fakeGenerate.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify([
          { identifier: 'INT-100', score: 95, reason: 'Cancelled issue with no outcome', category: 'cancelled' },
          { identifier: 'INT-300', score: 70, reason: 'Completed sub-issue', category: 'sub-issue' },
        ]),
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      },
    });

    const result = await classifier.classifyCandidates(issues, 2, logger);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.identifier).toBe('INT-100');
    expect(result.value[0]?.score).toBe(95);
    expect(result.value[0]?.category).toBe('cancelled');
    expect(result.value[1]?.identifier).toBe('INT-300');
  });

  it('filters out non-closed issues before sending to Gemini', async () => {
    const issues = [
      createTestIssue({ id: '1', identifier: 'INT-100', stateType: 'started' }),
      createTestIssue({ id: '2', identifier: 'INT-200', stateType: 'backlog' }),
      createTestIssue({ id: '3', identifier: 'INT-300', stateType: 'completed', state: 'Done' }),
    ];

    fakeGenerate.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify([
          { identifier: 'INT-300', score: 60, reason: 'Completed singular issue', category: 'simple-fix' },
        ]),
        usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
      },
    });

    const result = await classifier.classifyCandidates(issues, 5, logger);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only INT-300 should be in the prompt (completed/cancelled only)
    const firstCall = fakeGenerate.mock.calls[0];
    if (firstCall === undefined) {
      throw new Error('Expected generate to be called');
    }
    const promptArg = firstCall[0] as string;
    expect(promptArg).not.toContain('INT-100');
    expect(promptArg).not.toContain('INT-200');
    expect(promptArg).toContain('INT-300');
  });

  it('returns error when Gemini call fails', async () => {
    const issues = [
      createTestIssue({ id: '1', identifier: 'INT-100', stateType: 'cancelled', state: 'Canceled' }),
    ];

    fakeGenerate.mockResolvedValueOnce({
      ok: false,
      error: { code: 'API_ERROR', message: 'Gemini unavailable' },
    });

    const result = await classifier.classifyCandidates(issues, 5, logger);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
  });

  it('handles malformed Gemini JSON response gracefully', async () => {
    const issues = [
      createTestIssue({ id: '1', identifier: 'INT-100', stateType: 'cancelled', state: 'Canceled' }),
    ];

    fakeGenerate.mockResolvedValueOnce({
      ok: true,
      value: { content: 'not valid json at all', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    });

    const result = await classifier.classifyCandidates(issues, 5, logger);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL_ERROR');
    expect(result.error.message).toContain('parse');
  });

  it('enriches candidates with issue metadata from input', async () => {
    const issues = [
      createTestIssue({ id: 'uuid-1', identifier: 'INT-100', title: 'My task', stateType: 'cancelled', state: 'Canceled' }),
    ];

    fakeGenerate.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify([
          { identifier: 'INT-100', score: 90, reason: 'Cancelled', category: 'cancelled' },
        ]),
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    });

    const result = await classifier.classifyCandidates(issues, 5, logger);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.id).toBe('uuid-1');
    expect(result.value[0]?.title).toBe('My task');
  });

  it('returns empty array when no closed issues exist', async () => {
    const issues = [
      createTestIssue({ id: '1', identifier: 'INT-100', stateType: 'started' }),
    ];

    const result = await classifier.classifyCandidates(issues, 5, logger);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
    expect(fakeGenerate).not.toHaveBeenCalled();
  });

  it('handles issues with null description', async () => {
    const issues = [
      createTestIssue({ id: 'uuid-1', identifier: 'INT-100', description: null, stateType: 'cancelled', state: 'Canceled' }),
    ];

    fakeGenerate.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify([
          { identifier: 'INT-100', score: 85, reason: 'Cancelled with no description', category: 'cancelled' },
        ]),
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    });

    const result = await classifier.classifyCandidates(issues, 5, logger);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.identifier).toBe('INT-100');

    // Verify the prompt contains proper fallback values for null description
    const firstCall = fakeGenerate.mock.calls[0];
    if (firstCall === undefined) {
      throw new Error('Expected generate to be called');
    }
    const promptArg = firstCall[0] as string;
    expect(promptArg).toContain('"descriptionLength": 0');
    expect(promptArg).toContain('"descriptionPreview": ""');
  });

  it('filters out candidates with identifiers not in the issue map', async () => {
    const issues = [
      createTestIssue({ id: 'uuid-1', identifier: 'INT-100', title: 'Real issue', stateType: 'cancelled', state: 'Canceled' }),
    ];

    fakeGenerate.mockResolvedValueOnce({
      ok: true,
      value: {
        content: JSON.stringify([
          { identifier: 'INT-999', score: 90, reason: 'Hallucinated', category: 'cancelled' },
          { identifier: 'INT-100', score: 80, reason: 'Real', category: 'cancelled' },
        ]),
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    });

    const result = await classifier.classifyCandidates(issues, 5, logger);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.identifier).toBe('INT-100');
  });
});
