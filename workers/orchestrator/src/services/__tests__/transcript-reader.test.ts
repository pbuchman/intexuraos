import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  glob: vi.fn(),
}));

import { readFile, glob } from 'node:fs/promises';

const mockReadFile = vi.mocked(readFile);
const mockGlob = vi.mocked(glob);

const { readSessionTranscript } = await import('../transcript-reader.js');

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

    const result = await readSessionTranscript('/secrets', 'task_abc');
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

    const result = await readSessionTranscript('/secrets', 'task_abc');
    expect(result).toHaveLength(2);
  });

  it('returns empty array when session directory does not exist', async () => {
    mockGlob.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });

    const result = await readSessionTranscript('/secrets', 'task_nonexistent');
    expect(result).toEqual([]);
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

    const result = await readSessionTranscript('/secrets', 'task_abc');
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

    const result = await readSessionTranscript('/secrets', 'task_abc');
    expect(result).toHaveLength(2);
  });

  it('filters entries with null value', async () => {
    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/secrets/claude-session-task_abc/projects/-repo/session.jsonl';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce('null\n');

    const result = await readSessionTranscript('/secrets', 'task_abc');
    expect(result).toHaveLength(0);
  });

  it('filters entries with non-string type field', async () => {
    const noTypeString = JSON.stringify({ type: 123, message: { content: [] } });
    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/secrets/claude-session-task_abc/projects/-repo/session.jsonl';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce(`${noTypeString}\n`);

    const result = await readSessionTranscript('/secrets', 'task_abc');
    expect(result).toHaveLength(0);
  });

  it('filters entries with null message', async () => {
    const nullMessage = JSON.stringify({ type: 'assistant', message: null });
    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/secrets/claude-session-task_abc/projects/-repo/session.jsonl';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce(`${nullMessage}\n`);

    const result = await readSessionTranscript('/secrets', 'task_abc');
    expect(result).toHaveLength(0);
  });

  it('filters entries with non-array content', async () => {
    const badContent = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: 'not-an-array' },
    });
    async function* fakeGlob(): AsyncGenerator<string> {
      yield '/secrets/claude-session-task_abc/projects/-repo/session.jsonl';
    }
    mockGlob.mockReturnValueOnce(fakeGlob() as never);
    mockReadFile.mockResolvedValueOnce(`${badContent}\n`);

    const result = await readSessionTranscript('/secrets', 'task_abc');
    expect(result).toHaveLength(0);
  });
});
