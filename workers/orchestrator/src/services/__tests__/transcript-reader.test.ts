import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '@intexuraos/common-core';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  glob: vi.fn(),
}));

import { readFile, glob } from 'node:fs/promises';

const mockReadFile = vi.mocked(readFile);
const mockGlob = vi.mocked(glob);

const { readSessionTranscript } = await import('../transcript-reader.js');

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readSessionTranscript', () => {
  it('reads and parses JSONL entries from session directory', async () => {
    const entry1 = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'root',
      timestamp: '2026-03-08T23:10:00.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
      },
    });
    const entry2 = JSON.stringify({
      type: 'user',
      uuid: 'u1',
      parentUuid: 'a1',
      timestamp: '2026-03-08T23:10:01.000Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'World' }],
      },
    });

    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/secrets/claude-session-task_abc/projects/-repo/session.jsonl';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce(`${entry1}\n${entry2}\n`);

    const result = await readSessionTranscript('/secrets', 'task_abc', mockLogger);
    expect(result).toHaveLength(2);
    expect(result[0]?.type).toBe('assistant');
    expect(result[1]?.type).toBe('user');
  });

  it('skips malformed JSONL lines', async () => {
    const validEntry = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'root',
      timestamp: '2026-03-08T23:10:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    });

    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/secrets/claude-session-task_abc/projects/-repo/session.jsonl';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce(`${validEntry}\nBAD_JSON\n${validEntry}\n`);

    const result = await readSessionTranscript('/secrets', 'task_abc', mockLogger);
    expect(result).toHaveLength(2);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ skippedLines: 1 }),
      'Skipped malformed JSONL lines in transcript file'
    );
  });

  it('returns empty array when session directory does not exist', async () => {
    mockGlob.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });

    const result = await readSessionTranscript('/secrets', 'task_nonexistent', mockLogger);
    expect(result).toEqual([]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ secretsBasePath: '/secrets', taskId: 'task_nonexistent' }),
      'Failed to read session transcript'
    );
  });

  it('filters out entries without message.content', async () => {
    const valid = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'root',
      timestamp: '2026-03-08T23:10:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    });
    const noContent = JSON.stringify({
      type: 'progress',
      timestamp: '2026-03-08T23:10:00.000Z',
    });

    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/secrets/claude-session-task_abc/projects/-repo/session.jsonl';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce(`${valid}\n${noContent}\n`);

    const result = await readSessionTranscript('/secrets', 'task_abc', mockLogger);
    expect(result).toHaveLength(1);
  });

  it('reads from multiple JSONL files', async () => {
    const entry = (id: string): string =>
      JSON.stringify({
        type: 'assistant',
        uuid: id,
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: id }] },
      });

    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/secrets/claude-session-task_abc/projects/-repo/sess1.jsonl';
      yield '/secrets/claude-session-task_abc/projects/-repo/sess2.jsonl';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile
      .mockResolvedValueOnce(`${entry('a1')}\n`)
      .mockResolvedValueOnce(`${entry('a2')}\n`);

    const result = await readSessionTranscript('/secrets', 'task_abc', mockLogger);
    expect(result).toHaveLength(2);
  });

  it('filters entries with null value', async () => {
    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/secrets/claude-session-task_abc/projects/-repo/session.jsonl';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce('null\n');

    const result = await readSessionTranscript('/secrets', 'task_abc', mockLogger);
    expect(result).toHaveLength(0);
  });

  it('filters entries with non-string type field', async () => {
    const noTypeString = JSON.stringify({ type: 123, message: { content: [] } });
    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/secrets/claude-session-task_abc/projects/-repo/session.jsonl';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce(`${noTypeString}\n`);

    const result = await readSessionTranscript('/secrets', 'task_abc', mockLogger);
    expect(result).toHaveLength(0);
  });

  it('filters out entries with non-user/non-assistant type', async () => {
    const systemEntry = JSON.stringify({
      type: 'system',
      uuid: 's1',
      parentUuid: 'root',
      timestamp: '2026-03-08T23:10:00.000Z',
      message: { role: 'system', content: [{ type: 'text', text: 'system msg' }] },
    });
    const validEntry = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'root',
      timestamp: '2026-03-08T23:10:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    });

    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/secrets/claude-session-task_abc/projects/-repo/session.jsonl';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce(`${systemEntry}\n${validEntry}\n`);

    const result = await readSessionTranscript('/secrets', 'task_abc', mockLogger);
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe('assistant');
  });

  it('filters entries with null message', async () => {
    const nullMessage = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-03-08T23:10:00.000Z',
      message: null,
    });
    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/secrets/claude-session-task_abc/projects/-repo/session.jsonl';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce(`${nullMessage}\n`);

    const result = await readSessionTranscript('/secrets', 'task_abc', mockLogger);
    expect(result).toHaveLength(0);
  });

  it('sorts entries by timestamp across multiple files', async () => {
    const laterEntry = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'root',
      timestamp: '2026-03-08T23:15:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'later' }] },
    });
    const earlierEntry = JSON.stringify({
      type: 'user',
      uuid: 'u1',
      parentUuid: 'a1',
      timestamp: '2026-03-08T23:10:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'earlier' }] },
    });

    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/secrets/claude-session-task_abc/projects/-repo/sess1.jsonl';
      yield '/secrets/claude-session-task_abc/projects/-repo/sess2.jsonl';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    // File 1 has later timestamp, file 2 has earlier timestamp
    mockReadFile
      .mockResolvedValueOnce(`${laterEntry}\n`)
      .mockResolvedValueOnce(`${earlierEntry}\n`);

    const result = await readSessionTranscript('/secrets', 'task_abc', mockLogger);
    expect(result).toHaveLength(2);
    expect(result[0]?.timestamp).toBe('2026-03-08T23:10:00.000Z');
    expect(result[1]?.timestamp).toBe('2026-03-08T23:15:00.000Z');
  });

  it('filters entries with missing timestamp', async () => {
    const noTimestamp = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'root',
      message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    });
    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/secrets/claude-session-task_abc/projects/-repo/session.jsonl';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce(`${noTimestamp}\n`);

    const result = await readSessionTranscript('/secrets', 'task_abc', mockLogger);
    expect(result).toHaveLength(0);
  });

  it('filters entries with non-array content', async () => {
    const badContent = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-03-08T23:10:00.000Z',
      message: { role: 'assistant', content: 'not-an-array' },
    });
    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/secrets/claude-session-task_abc/projects/-repo/session.jsonl';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce(`${badContent}\n`);

    const result = await readSessionTranscript('/secrets', 'task_abc', mockLogger);
    expect(result).toHaveLength(0);
  });
});
