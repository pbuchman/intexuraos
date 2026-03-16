import { describe, it, expect } from 'vitest';
import { formatTranscript, type SessionJsonlEntry } from '../transcript-formatter.js';

describe('formatTranscript', () => {
  it('formats assistant tool_use as numbered message', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_abc',
              name: 'Bash',
              input: { command: 'pnpm run ci:tracked', description: 'Run CI' },
            },
          ],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('[MSG-001] ASSISTANT tool_use: Bash');
    expect(result).toContain('command: "pnpm run ci:tracked"');
  });

  it('formats user tool_result paired to tool_use', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_abc', name: 'Bash', input: { command: 'echo hi' } },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: 'a1',
        timestamp: '2026-03-08T23:10:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_abc', content: 'hi\n' }],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('[MSG-002] USER tool_result (for toolu_abc)');
    expect(result).toContain('hi');
  });

  it('formats assistant text messages', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Review completed with zero issues.' }],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('[MSG-001] ASSISTANT text:');
    expect(result).toContain('Review completed with zero issues.');
  });

  it('marks meta/skill-injection entries', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: 'a1',
        timestamp: '2026-03-08T23:10:00.000Z',
        isMeta: true,
        message: {
          role: 'user',
          content: [{ type: 'text', text: '# Requesting Code Review\nDispatch subagent...' }],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('[MSG-001] USER (meta/skill-content)');
  });

  it('truncates tool results longer than 500 chars', () => {
    const longOutput = 'x'.repeat(1000);
    const entries: SessionJsonlEntry[] = [
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: 'a1',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_abc', content: longOutput }],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('[truncated');
    expect(result.length).toBeLessThan(longOutput.length);
  });

  it('preserves error results without truncation', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: 'a1',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_abc',
              content: '<tool_use_error>No task found with ID: task_abc</tool_use_error>',
            },
          ],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('No task found with ID: task_abc');
    expect(result).toContain('ERROR');
  });

  it('handles multiple content blocks in a single assistant message', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_use', id: 'toolu_abc', name: 'Bash', input: { command: 'ls' } },
            { type: 'tool_use', id: 'toolu_def', name: 'Read', input: { file_path: '/repo/a.ts' } },
          ],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('[MSG-001] ASSISTANT text:');
    expect(result).toContain('[MSG-001] ASSISTANT tool_use: Bash');
    expect(result).toContain('[MSG-001] ASSISTANT tool_use: Read');
  });

  it('truncates assistant text blocks longer than 500 chars', () => {
    const longText = 'y'.repeat(1000);
    const entries: SessionJsonlEntry[] = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: longText }],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('[truncated]');
    expect(result.length).toBeLessThan(longText.length);
  });

  it('returns empty string for empty entries', () => {
    expect(formatTranscript([])).toBe('');
  });

  it('handles Skill tool_use entries with skill name in input', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_abc',
              name: 'Skill',
              input: { skill: 'superpowers:requesting-code-review' },
            },
          ],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('Skill(superpowers:requesting-code-review)');
  });

  it('does not include skill field in formatted input for Skill tool_use', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_abc',
              name: 'Skill',
              input: { skill: 'superpowers:requesting-code-review', args: '--verbose' },
            },
          ],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('Skill(superpowers:requesting-code-review)');
    expect(result).not.toContain('skill: "superpowers:requesting-code-review"');
    expect(result).toContain('args: "--verbose"');
  });

  it('handles Agent tool_use entries', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_abc',
              name: 'Agent',
              input: { description: 'Review code', subagent_type: 'superpowers:code-reviewer' },
            },
          ],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('Agent(superpowers:code-reviewer)');
  });

  it('handles Skill tool_use without skill input key', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_abc', name: 'Skill', input: {} }],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('ASSISTANT tool_use: Skill');
    expect(result).not.toContain('Skill(');
  });

  it('handles Agent tool_use without subagent_type input key', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_abc', name: 'Agent', input: { description: 'task' } },
          ],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('ASSISTANT tool_use: Agent');
    expect(result).not.toContain('Agent(');
  });

  it('truncates input values longer than 200 chars', () => {
    const longValue = 'z'.repeat(300);
    const entries: SessionJsonlEntry[] = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_abc', name: 'Bash', input: { command: longValue } },
          ],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(longValue.length + 200);
  });

  it('serializes non-string input values as JSON', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_abc', name: 'Bash', input: { timeout: 5000 } }],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('timeout: "5000"');
  });

  it('skips thinking blocks without crashing', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'Let me analyze this...',
            } as unknown as SessionJsonlEntry['message']['content'][0],
          ],
        },
      },
    ];
    const result = formatTranscript(entries);
    // Should produce a message line but skip the unknown block content
    expect(result).not.toContain('TypeError');
    expect(result).not.toContain('thinking');
  });

  it('skips unknown block types without crashing', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'server_tool_use',
              id: 'srv_1',
              name: 'some_tool',
            } as unknown as SessionJsonlEntry['message']['content'][0],
          ],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).not.toContain('tool_result');
    expect(result).toBe('');
  });

  it('handles mix of known and unknown block types in same message', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'root',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'hmm',
            } as unknown as SessionJsonlEntry['message']['content'][0],
            { type: 'text', text: 'Here is my answer.' },
            { type: 'tool_use', id: 'toolu_abc', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('[MSG-001] ASSISTANT text:');
    expect(result).toContain('Here is my answer.');
    expect(result).toContain('[MSG-001] ASSISTANT tool_use: Bash');
    expect(result).not.toContain('thinking');
  });

  it('handles tool_result with nested content array', () => {
    const entries: SessionJsonlEntry[] = [
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: 'a1',
        timestamp: '2026-03-08T23:10:00.000Z',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_abc',
              content: [
                { type: 'text', text: 'Launching skill: superpowers:requesting-code-review' },
              ],
            },
          ],
        },
      },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('Launching skill');
  });
});
