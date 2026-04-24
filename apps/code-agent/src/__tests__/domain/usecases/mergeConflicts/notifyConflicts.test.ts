import { err, ok } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import {
  buildConflictCommentBody,
  buildTaskUrl,
  updateManagedComment,
} from '../../../../domain/usecases/mergeConflicts/notifyConflicts.js';

function createLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

describe('buildTaskUrl', () => {
  it('uses INTEXURAOS_WEB_URL when set', () => {
    const original = process.env['INTEXURAOS_WEB_URL'];
    process.env['INTEXURAOS_WEB_URL'] = 'https://example.com';
    expect(buildTaskUrl('task-1')).toBe('https://example.com/#/code-tasks/task-1');
    if (original === undefined) {
      delete process.env['INTEXURAOS_WEB_URL'];
    } else {
      process.env['INTEXURAOS_WEB_URL'] = original;
    }
  });

  it('falls back to default web url when env var is absent', () => {
    const original = process.env['INTEXURAOS_WEB_URL'];
    delete process.env['INTEXURAOS_WEB_URL'];
    expect(buildTaskUrl('task-1')).toBe('https://intexuraos.cloud/#/code-tasks/task-1');
    if (original !== undefined) {
      process.env['INTEXURAOS_WEB_URL'] = original;
    }
  });
});

describe('buildConflictCommentBody', () => {
  it('omits task link and starting body phases include task link', () => {
    const body = buildConflictCommentBody({
      phase: 'starting',
      repository: 'owner/repo',
      prNumber: 42,
      baseBranch: 'main',
      taskId: 'task-1',
    });
    expect(body).toContain('Task: [task-1]');
    expect(body).toContain('Automated conflict resolution has started.');
  });

  it('returns resolved body without task link', () => {
    const body = buildConflictCommentBody({
      phase: 'resolved',
      repository: 'owner/repo',
      prNumber: 42,
      baseBranch: 'main',
      taskId: 'task-1',
    });
    expect(body).not.toContain('Task: [task-1]');
    expect(body).toContain('appears to be resolved');
  });

  it('emits queued phase message', () => {
    const body = buildConflictCommentBody({
      phase: 'queued',
      repository: 'owner/repo',
      prNumber: 1,
      baseBranch: 'main',
      taskId: 'task-1',
    });
    expect(body).toContain('queued and will start');
  });

  it('emits no-worker phase message', () => {
    const body = buildConflictCommentBody({
      phase: 'no-worker',
      repository: 'owner/repo',
      prNumber: 1,
      baseBranch: 'main',
    });
    expect(body).toContain('no enabled worker mapping');
  });

  it('emits failed phase message', () => {
    const body = buildConflictCommentBody({
      phase: 'failed',
      repository: 'owner/repo',
      prNumber: 1,
      baseBranch: 'main',
    });
    expect(body).toContain('A future push will retry');
  });
});

describe('updateManagedComment', () => {
  const token = 'token';
  const owner = 'owner';
  const repo = 'repo';
  const prNumber = 42;

  interface ClientStub {
    postPRComment: ReturnType<typeof vi.fn>;
    updateIssueComment: ReturnType<typeof vi.fn>;
  }

  function createClient(): ClientStub {
    return {
      postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 2001 })),
      updateIssueComment: vi.fn().mockResolvedValue(ok({ commentId: 1001 })),
    };
  }

  it('updates existing comment when commentId is provided', async () => {
    const client = createClient();
    const logger = createLogger();
    const result = await updateManagedComment(client as never, token, owner, repo, prNumber, 1001, 'body', logger);
    expect(client.updateIssueComment).toHaveBeenCalledWith(token, owner, repo, 1001, 'body');
    expect(client.postPRComment).not.toHaveBeenCalled();
    expect(result).toBe(1001);
  });

  it('creates a new comment when commentId is null', async () => {
    const client = createClient();
    const logger = createLogger();
    const result = await updateManagedComment(client as never, token, owner, repo, prNumber, null, 'body', logger);
    expect(client.updateIssueComment).not.toHaveBeenCalled();
    expect(client.postPRComment).toHaveBeenCalledWith(token, owner, repo, prNumber, 'body');
    expect(result).toBe(2001);
  });

  it('falls back to posting a new comment when updating fails', async () => {
    const client = createClient();
    client.updateIssueComment.mockResolvedValue(err({ code: 'GONE', message: 'removed' }));
    const logger = createLogger();
    const result = await updateManagedComment(client as never, token, owner, repo, prNumber, 1001, 'body', logger);
    expect(client.postPRComment).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
    expect(result).toBe(2001);
  });

  it('returns null when both update and create fail', async () => {
    const client = createClient();
    client.updateIssueComment.mockResolvedValue(err({ code: 'GONE', message: 'removed' }));
    client.postPRComment.mockResolvedValue(err({ code: 'API_ERROR', message: 'boom' }));
    const logger = createLogger();
    const result = await updateManagedComment(client as never, token, owner, repo, prNumber, 1001, 'body', logger);
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('returns null when initial post fails', async () => {
    const client = createClient();
    client.postPRComment.mockResolvedValue(err({ code: 'API_ERROR', message: 'boom' }));
    const logger = createLogger();
    const result = await updateManagedComment(client as never, token, owner, repo, prNumber, null, 'body', logger);
    expect(result).toBeNull();
  });
});
