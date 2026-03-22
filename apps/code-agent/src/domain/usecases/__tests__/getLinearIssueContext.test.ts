import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { LinearAgentClient } from '../../ports/linearAgentClient.js';
import { getLinearIssueContext } from '../getLinearIssueContext.js';

const mockLogger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function createFakeClient(
  overrides: Partial<LinearAgentClient> = {}
): LinearAgentClient {
  return {
    createIssue(): ReturnType<LinearAgentClient['createIssue']> { return Promise.resolve(err({ code: 'UNKNOWN', message: 'not implemented' })); },
    updateIssueState(): ReturnType<LinearAgentClient['updateIssueState']> { return Promise.resolve(err({ code: 'UNKNOWN', message: 'not implemented' })); },
    validateIssue(): ReturnType<LinearAgentClient['validateIssue']> { return Promise.resolve(err({ code: 'UNKNOWN', message: 'not implemented' })); },
    generateTitle(): ReturnType<LinearAgentClient['generateTitle']> { return Promise.resolve(err({ code: 'UNKNOWN', message: 'not implemented' })); },
    addComment(): ReturnType<LinearAgentClient['addComment']> { return Promise.resolve(err({ code: 'UNKNOWN', message: 'not implemented' })); },
    fetchIssueTree(): ReturnType<LinearAgentClient['fetchIssueTree']> { return Promise.resolve(err({ code: 'UNKNOWN', message: 'not implemented' })); },
    updateIssueMetadata(): ReturnType<LinearAgentClient['updateIssueMetadata']> { return Promise.resolve(err({ code: 'UNKNOWN', message: 'not implemented' })); },
    fetchIssueForDisplay(): ReturnType<LinearAgentClient['fetchIssueForDisplay']> { return Promise.resolve(err({ code: 'UNKNOWN', message: 'not implemented' })); },
    fetchIssuesForDisplay(): ReturnType<LinearAgentClient['fetchIssuesForDisplay']> { return Promise.resolve(err({ code: 'UNKNOWN', message: 'not implemented' })); },
    getIssueDescription(): ReturnType<LinearAgentClient['getIssueDescription']> { return Promise.resolve(err({ code: 'UNKNOWN', message: 'not implemented' })); },
    getIssueContext(): ReturnType<LinearAgentClient['getIssueContext']> { return Promise.resolve(err({ code: 'UNKNOWN', message: 'not implemented' })); },
    ...overrides,
  };
}

describe('getLinearIssueContext', () => {
  it('returns context with plan path when description contains plan reference', async () => {
    const client = createFakeClient({
      getIssueContext(): ReturnType<LinearAgentClient['getIssueContext']> {
        return Promise.resolve(ok({
          description: 'Plan document: docs/plans/2026-03-20-my-plan.md',
          comments: [{ body: 'looks good', createdAt: '2026-03-20T10:00:00Z' }],
        }));
      },
    });

    const result = await getLinearIssueContext('INT-100', {
      linearAgentClient: client,
      logger: mockLogger,
    });

    expect(result).toEqual({
      status: 'ok',
      data: {
        description: 'Plan document: docs/plans/2026-03-20-my-plan.md',
        comments: [{ body: 'looks good', createdAt: '2026-03-20T10:00:00Z' }],
        planDocumentPath: 'docs/plans/2026-03-20-my-plan.md',
      },
    });
  });

  it('returns planDocumentPath: null when no plan reference exists', async () => {
    const client = createFakeClient({
      getIssueContext(): ReturnType<LinearAgentClient['getIssueContext']> {
        return Promise.resolve(ok({
          description: 'A normal description without any plan link',
          comments: [],
        }));
      },
    });

    const result = await getLinearIssueContext('INT-200', {
      linearAgentClient: client,
      logger: mockLogger,
    });

    expect(result).toEqual({
      status: 'ok',
      data: {
        description: 'A normal description without any plan link',
        comments: [],
        planDocumentPath: null,
      },
    });
  });

  it('returns not_found when issue is not found (NOT_FOUND error)', async () => {
    const client = createFakeClient({
      getIssueContext(): ReturnType<LinearAgentClient['getIssueContext']> {
        return Promise.resolve(err({ code: 'NOT_FOUND' as const, message: 'Issue not found' }));
      },
    });

    const result = await getLinearIssueContext('INT-999', {
      linearAgentClient: client,
      logger: mockLogger,
    });

    expect(result).toEqual({ status: 'not_found' });
  });

  it('returns error status on linear-agent error and logs warning', async () => {
    const warnFn = vi.fn();
    const logger: Logger = { info: vi.fn(), warn: warnFn, error: vi.fn(), debug: vi.fn() };

    const client = createFakeClient({
      getIssueContext(): ReturnType<LinearAgentClient['getIssueContext']> {
        return Promise.resolve(err({ code: 'UNAVAILABLE' as const, message: 'Service down' }));
      },
    });

    const result = await getLinearIssueContext('INT-300', {
      linearAgentClient: client,
      logger,
    });

    expect(result).toEqual({ status: 'error', code: 'UNAVAILABLE' });
    expect(warnFn).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'INT-300' }),
      'Failed to fetch issue context from linear-agent'
    );
  });

  it('resolves plan path from comment when description has none', async () => {
    const client = createFakeClient({
      getIssueContext(): ReturnType<LinearAgentClient['getIssueContext']> {
        return Promise.resolve(ok({
          description: null,
          comments: [
            { body: 'Plan document: docs/plans/2026-03-20-from-comment.md', createdAt: '2026-03-20T12:00:00Z' },
          ],
        }));
      },
    });

    const result = await getLinearIssueContext('INT-400', {
      linearAgentClient: client,
      logger: mockLogger,
    });

    expect(result).toEqual({
      status: 'ok',
      data: {
        description: null,
        comments: [
          { body: 'Plan document: docs/plans/2026-03-20-from-comment.md', createdAt: '2026-03-20T12:00:00Z' },
        ],
        planDocumentPath: 'docs/plans/2026-03-20-from-comment.md',
      },
    });
  });
});
