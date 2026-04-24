import { Timestamp } from '@google-cloud/firestore';
import { describe, it, expect } from 'vitest';
import {
  type FormatterState,
  formatLogChunk,
} from '../../../../domain/services/logFormatter.js';
import {
  extractToolContext,
  formatAssistant,
  formatObjectKeysSummary,
  formatToolResult,
  formatToolUse,
  formatUser,
  registerToolContext,
  type StreamJsonMessage,
  summarizeDiff,
  summarizeJsonArray,
  summarizeJsonContent,
} from '../../../../domain/services/logFormatter/markdownFormatter.js';

function newState(): FormatterState {
  return { toolCallsById: new Map<string, string>(), lastToolName: undefined };
}

describe('markdown formatter helpers', () => {
  it('formatAssistant extracts text and tool_use blocks from assistant messages', () => {
    const msg: StreamJsonMessage = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } },
        ],
      },
    };
    expect(formatAssistant(msg)).toBe('[claude] hello\n[tool] Read: /a.ts');
  });

  it('formatToolUse renders tool_use messages and records the tool name in state', () => {
    const state = newState();
    const msg: StreamJsonMessage = {
      type: 'tool_use',
      id: 'call-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
    };
    expect(formatToolUse(msg, state)).toBe('[tool] Bash: ls -la');
    expect(state.lastToolName).toBe('Bash');
    expect(state.toolCallsById.get('call-1')).toBe('Bash');
  });

  it('formatToolResult renders errors using the error prefix', () => {
    expect(formatToolResult('command failed', true, 'Bash')).toBe('  ✗ command failed');
  });

  it('formatToolResult suppresses successful Read output', () => {
    expect(formatToolResult('file contents here', false, 'Read')).toBe('');
  });

  it('formatUser renders user messages that contain tool_result blocks', () => {
    const state: FormatterState = {
      toolCallsById: new Map<string, string>([['call-1', 'Bash']]),
      lastToolName: 'Bash',
    };
    const msg: StreamJsonMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-1',
            content: 'oops',
            is_error: true,
          },
        ],
      },
    };
    expect(formatUser(msg, state)).toBe('  ✗ oops');
  });
});

describe('registerToolContext', () => {
  it('records id->name mapping and lastToolName from assistant tool_use blocks', () => {
    const state = newState();
    const msg: StreamJsonMessage = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'abc', name: 'Grep', input: { pattern: 'foo' } },
        ],
      },
    };
    registerToolContext(msg, state);
    expect(state.lastToolName).toBe('Grep');
    expect(state.toolCallsById.get('abc')).toBe('Grep');
  });

  it('records id->name mapping and lastToolName from a tool_use message', () => {
    const state = newState();
    const msg: StreamJsonMessage = {
      type: 'tool_use',
      id: 'xyz',
      tool_name: 'Write',
    };
    registerToolContext(msg, state);
    expect(state.lastToolName).toBe('Write');
    expect(state.toolCallsById.get('xyz')).toBe('Write');
  });

  it('is a no-op when an assistant message has no array content', () => {
    const state = newState();
    const msg: StreamJsonMessage = { type: 'assistant' };
    registerToolContext(msg, state);
    expect(state.lastToolName).toBeUndefined();
    expect(state.toolCallsById.size).toBe(0);
  });
});

describe('extractToolContext', () => {
  it('returns file_path when present', () => {
    expect(extractToolContext({ file_path: '/src/x.ts' })).toBe('/src/x.ts');
  });

  it('truncates a long command at 80 chars with an ellipsis', () => {
    const cmd = 'a'.repeat(100);
    const out = extractToolContext({ command: cmd });
    expect(out).toHaveLength(80);
    expect(out?.endsWith('...')).toBe(true);
    expect(out?.startsWith('a'.repeat(77))).toBe(true);
  });

  it('returns a pattern literally', () => {
    expect(extractToolContext({ pattern: 'foo.*bar' })).toBe('foo.*bar');
  });

  it('truncates a long query at 60 chars', () => {
    const q = 'q'.repeat(100);
    const out = extractToolContext({ query: q });
    expect(out).toHaveLength(60);
    expect(out?.endsWith('...')).toBe(true);
  });

  it('truncates a long description at 60 chars', () => {
    const d = 'd'.repeat(100);
    const out = extractToolContext({ description: d });
    expect(out).toHaveLength(60);
    expect(out?.endsWith('...')).toBe(true);
  });

  it('truncates a long url at 80 chars', () => {
    const u = 'https://example.com/' + 'u'.repeat(200);
    const out = extractToolContext({ url: u });
    expect(out).toHaveLength(80);
    expect(out?.endsWith('...')).toBe(true);
  });

  it('returns skill literally', () => {
    expect(extractToolContext({ skill: 'release' })).toBe('release');
  });

  it('returns undefined when there is no recognised key', () => {
    expect(extractToolContext({ foo: 'bar' })).toBeUndefined();
    expect(extractToolContext(undefined)).toBeUndefined();
  });
});

describe('summarizeJsonContent', () => {
  it('summarizes a GitHub PR JSON payload', () => {
    const pr = {
      number: 42,
      title: 'Fix the thing',
      state: 'OPEN',
      headRefName: 'feature/fix',
      additions: 10,
      deletions: 3,
      changedFiles: 2,
      pad: 'x'.repeat(200),
    };
    const json = JSON.stringify(pr);
    const out = summarizeJsonContent(json);
    expect(out).toBe('#42 Fix the thing | OPEN | +10/-3 | 2 files');
  });

  it('summarizes a GitHub comment JSON payload', () => {
    const comment = {
      id: 12345,
      html_url: 'https://github.com/o/r/issues/909#issuecomment-1',
      body: 'hello',
      pad: 'x'.repeat(200),
    };
    const json = JSON.stringify(comment);
    expect(summarizeJsonContent(json)).toBe('Created comment 12345 on #909');
  });

  it('summarizes a generic large JSON object via key count', () => {
    const obj: Record<string, unknown> = {
      a: 1,
      b: 2,
      c: 3,
      d: 4,
      e: 5,
      pad: 'x'.repeat(200),
    };
    const json = JSON.stringify(obj);
    expect(summarizeJsonContent(json)).toBe(
      `{6 keys: a, b, c, d, e, ...} [${String(json.length)} chars]`,
    );
  });

  it('returns undefined for short content', () => {
    expect(summarizeJsonContent('{"a":1}')).toBeUndefined();
  });

  it('returns undefined for invalid JSON', () => {
    expect(summarizeJsonContent('not json ' + 'x'.repeat(200))).toBeUndefined();
  });
});

describe('summarizeJsonArray', () => {
  it('summarizes a PR reviews array', () => {
    const reviews = [
      {
        submitted_at: '2024-01-01T00:00:00Z',
        state: 'APPROVED',
        html_url: 'https://x/r/1',
        user: { login: 'octocat' },
        pad: 'x'.repeat(200),
      },
    ];
    const json = JSON.stringify(reviews);
    expect(summarizeJsonArray(json)).toBe('1 PR review: octocat APPROVED');
  });

  it('summarizes a PR review comments array', () => {
    const comments = [
      {
        pull_request_review_id: 1,
        path: 'src/components/Thing.tsx',
        line: 42,
        user: { login: 'octocat' },
        pad: 'x'.repeat(200),
      },
      {
        pull_request_review_id: 1,
        path: 'src/components/Thing.tsx',
        line: 99,
        user: { login: 'octocat' },
      },
    ];
    const json = JSON.stringify(comments);
    expect(summarizeJsonArray(json)).toBe('2 review comments by octocat on Thing.tsx:42');
  });

  it('summarizes an issue comments array with grouped logins', () => {
    const comments = [
      {
        issue_url: 'https://x/issues/1',
        body: 'hello',
        html_url: 'https://x/c/1',
        user: { login: 'alice' },
        pad: 'x'.repeat(200),
      },
      {
        issue_url: 'https://x/issues/1',
        body: 'hi again',
        html_url: 'https://x/c/2',
        user: { login: 'alice' },
      },
      {
        issue_url: 'https://x/issues/1',
        body: 'hey',
        html_url: 'https://x/c/3',
        user: { login: 'bob' },
      },
    ];
    const json = JSON.stringify(comments);
    expect(summarizeJsonArray(json)).toBe('3 issue comments: alice (×2), bob');
  });

  it('falls back to [N items] with key hints for generic object arrays', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ foo: i, bar: 'b', baz: 'c' }));
    const json = JSON.stringify(items);
    expect(json.length).toBeGreaterThanOrEqual(200);
    expect(summarizeJsonArray(json)).toBe('[30 items (foo, bar, baz)]');
  });

  it('returns undefined for short content', () => {
    expect(summarizeJsonArray('[{"a":1}]')).toBeUndefined();
  });

  it('returns undefined for invalid JSON', () => {
    expect(summarizeJsonArray('[not json ' + 'x'.repeat(200))).toBeUndefined();
  });

  it('returns undefined for an array of primitives', () => {
    const arr = Array.from({ length: 60 }, (_, i) => `primitive-string-${String(i)}`);
    const json = JSON.stringify(arr);
    expect(json.length).toBeGreaterThanOrEqual(200);
    expect(summarizeJsonArray(json)).toBeUndefined();
  });
});

describe('summarizeDiff', () => {
  it('summarizes a diff with added, deleted, and modified files', () => {
    const diff = [
      'diff --git a/new.ts b/new.ts',
      '--- /dev/null',
      '+++ b/new.ts',
      '+console.log("hi")',
      '+console.log("bye")',
      'diff --git a/old.ts b/old.ts',
      '--- a/old.ts',
      '+++ /dev/null',
      '-removed line',
      'diff --git a/changed.ts b/changed.ts',
      '--- a/changed.ts',
      '+++ b/changed.ts',
      '+added',
      '-removed',
    ].join('\n');

    const out = summarizeDiff(diff);
    expect(out).toBe(
      [
        'diff: 3 files changed (+3, -2)',
        '      A new.ts (+2)',
        '      D old.ts (-1)',
        '      M changed.ts (+1, -1)',
      ].join('\n'),
    );
  });

  it('returns undefined when no diff headers are present', () => {
    expect(summarizeDiff('')).toBeUndefined();
    expect(summarizeDiff('nothing diff-like here')).toBeUndefined();
  });

  it('shortens long paths with more than 6 components', () => {
    const longPath = 'a/b/c/d/e/f/g/h/file.ts';
    const diff = [
      `diff --git a/${longPath} b/${longPath}`,
      `--- a/${longPath}`,
      `+++ b/${longPath}`,
      '+added',
    ].join('\n');

    const out = summarizeDiff(diff);
    expect(out).toBeDefined();
    // First 4 components kept, then '...', then file name
    expect(out).toContain('a/b/c/d/.../file.ts');
    expect(out).not.toContain('e/f/g/h/file.ts');
  });
});

describe('formatObjectKeysSummary', () => {
  it('formats up to 5 keys followed by ", ..." when there are more', () => {
    expect(formatObjectKeysSummary(['a', 'b', 'c', 'd', 'e', 'f'], 321)).toBe(
      '{6 keys: a, b, c, d, e, ...} [321 chars]',
    );
  });

  it('does not append ", ..." when there are 5 or fewer keys', () => {
    expect(formatObjectKeysSummary(['a', 'b'], 10)).toBe('{2 keys: a, b} [10 chars]');
  });
});

describe('formatLogChunk integration (assistant -> tool_use -> tool_result)', () => {
  it('renders a full sequence using a shared FormatterState (snapshot)', () => {
    const state = newState();
    const timestamp = Timestamp.fromMillis(0);

    const assistant = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Running a command' },
          { type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'echo hi' } },
        ],
      },
    });
    const userResult = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-1',
            content: 'hi',
            is_error: false,
          },
        ],
      },
    });

    const lines = formatLogChunk(`${assistant}\n${userResult}`, 0, timestamp, state);
    expect(lines.map((l) => l.text).join('\n')).toMatchInlineSnapshot(`
      "[claude] Running a command
      [tool] Bash: echo hi
        → hi"
    `);
  });
});
