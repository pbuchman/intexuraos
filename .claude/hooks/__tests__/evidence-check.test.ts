import { describe, it, beforeEach, expect } from 'vitest';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  executeHookSync,
  clearHooksLog,
  expectJsonOutput,
  expectAllowed,
} from './helpers/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createTranscript(
  messages: { type: string; message?: { content: { type: string; text?: string }[] } }[]
): string {
  const tempDir = path.join(__dirname, 'fixtures', 'temp-files');
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const transcriptPath = path.join(tempDir, `transcript-${randomUUID()}.jsonl`);
  const lines = messages.map((msg) => JSON.stringify(msg)).join('\n');
  writeFileSync(transcriptPath, lines + '\n', 'utf-8');

  return transcriptPath;
}

function cleanupTranscript(transcriptPath: string): void {
  if (existsSync(transcriptPath)) {
    try {
      unlinkSync(transcriptPath);
    } catch {
      // Ignore
    }
  }
}

describe.sequential('Claude Hooks - Evidence Check', () => {
  beforeEach(() => {
    clearHooksLog();
  });

  describe('evidence-check.sh', () => {
    describe('speculative language detection', () => {
      it('blocks "likely" in plain text', () => {
        const transcriptPath = createTranscript([
          { type: 'user', message: { content: [{ type: 'text', text: 'What port is it on?' }] } },
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Both are listening on the same port (likely 8130).' },
              ],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'evidence-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'likely',
        });

        cleanupTranscript(transcriptPath);
      });

      it('blocks "should work" in plain text', () => {
        const transcriptPath = createTranscript([
          { type: 'user', message: { content: [{ type: 'text', text: 'Did you fix it?' }] } },
          {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'I updated the config. This should work now.' }],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'evidence-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'should work',
        });

        cleanupTranscript(transcriptPath);
      });

      it('blocks "probably" in plain text', () => {
        const transcriptPath = createTranscript([
          { type: 'user', message: { content: [{ type: 'text', text: 'Why did it fail?' }] } },
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'The test is probably failing due to a race condition.' },
              ],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'evidence-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'probably',
        });

        cleanupTranscript(transcriptPath);
      });
    });

    describe('patterns in code blocks (should be ignored)', () => {
      it('ignores "likely" inside inline backticks', () => {
        const transcriptPath = createTranscript([
          { type: 'user', message: { content: [{ type: 'text', text: 'What does this mean?' }] } },
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'text',
                  text: 'The variable `likely` is used as a boolean flag in this function.',
                },
              ],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'evidence-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectAllowed(result);
        expect(result.stdout).toBe('');

        cleanupTranscript(transcriptPath);
      });

      it('ignores "likely" inside fenced code blocks', () => {
        const transcriptPath = createTranscript([
          { type: 'user', message: { content: [{ type: 'text', text: 'Show me the code.' }] } },
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'text',
                  text: '```typescript\n// This is likely the cause\nconst likely = true;\n```',
                },
              ],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'evidence-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectAllowed(result);

        cleanupTranscript(transcriptPath);
      });

      it('blocks when pattern appears both inside and outside code blocks', () => {
        const transcriptPath = createTranscript([
          { type: 'user', message: { content: [{ type: 'text', text: 'What happened?' }] } },
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'text',
                  text: '```bash\n# likely a timing issue\n```\nThis is likely a race condition in the code.',
                },
              ],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'evidence-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'likely',
        });

        cleanupTranscript(transcriptPath);
      });
    });

    describe('allowed language patterns', () => {
      it('allows evidence-backed language', () => {
        const transcriptPath = createTranscript([
          { type: 'user', message: { content: [{ type: 'text', text: 'Did it pass?' }] } },
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'text',
                  text: 'Verified: all 42 tests pass. The build completed successfully with zero errors.',
                },
              ],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'evidence-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectAllowed(result);
        expect(result.stdout).toBe('');

        cleanupTranscript(transcriptPath);
      });
    });

    describe('edge cases', () => {
      it('allows when transcript_path is not provided', () => {
        const result = executeHookSync({
          hookName: 'evidence-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
          },
        });

        expectAllowed(result);
      });

      it('allows when transcript file does not exist', () => {
        const result = executeHookSync({
          hookName: 'evidence-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: '/nonexistent/path/transcript.jsonl',
          },
        });

        expectAllowed(result);
      });

      it('allows when no assistant messages exist', () => {
        const transcriptPath = createTranscript([
          {
            type: 'user',
            message: { content: [{ type: 'text', text: 'Hello' }] },
          },
        ]);

        const result = executeHookSync({
          hookName: 'evidence-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectAllowed(result);

        cleanupTranscript(transcriptPath);
      });

      it('is case-insensitive for pattern matching', { timeout: 20000 }, () => {
        const transcriptPath = createTranscript([
          {
            type: 'user',
            message: { content: [{ type: 'text', text: 'What happened?' }] },
          },
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'text',
                  text: 'This is LIKELY a configuration issue on the server.',
                },
              ],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'evidence-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectJsonOutput(result, {
          decision: 'block',
        });

        cleanupTranscript(transcriptPath);
      });
    });
  });
});
