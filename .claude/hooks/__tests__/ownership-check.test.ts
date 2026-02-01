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

/**
 * Creates a temporary transcript file in JSONL format for testing ownership-check
 * JSONL format = one JSON object per line
 *
 * The hook expects: .message.content[] where each content block has .type and .text
 */
function createTranscript(
  messages: { type: string; message?: { content: { type: string; text?: string }[] } }[]
): string {
  const tempDir = path.join(__dirname, 'fixtures', 'temp-files');
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const transcriptPath = path.join(tempDir, `transcript-${randomUUID()}.jsonl`);

  // Write each message as a separate line (JSONL format)
  const lines = messages.map((msg) => JSON.stringify(msg)).join('\n');
  writeFileSync(transcriptPath, lines + '\n', 'utf-8');

  return transcriptPath;
}

/**
 * Clean up transcript file
 */
function cleanupTranscript(transcriptPath: string): void {
  if (existsSync(transcriptPath)) {
    try {
      unlinkSync(transcriptPath);
    } catch {
      // Ignore
    }
  }
}

describe('Claude Hooks - Ownership Check', () => {
  beforeEach(() => {
    clearHooksLog();
  });

  describe('ownership-check.sh', () => {
    describe('forbidden ownership language detection', () => {
      it('blocks "pre-existing" pattern', () => {
        const transcriptPath = createTranscript([
          { type: 'user', message: { content: [{ type: 'text', text: 'What went wrong?' }] } },
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'This was a pre-existing issue that was already here.' },
              ],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'ownership-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'pre-existing',
        });

        cleanupTranscript(transcriptPath);
      });

      it('blocks "already broken" pattern', () => {
        const transcriptPath = createTranscript([
          { type: 'user', message: { content: [{ type: 'text', text: 'What happened?' }] } },
          {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'The code was already broken when I got here.' }],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'ownership-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'already broken',
        });

        cleanupTranscript(transcriptPath);
      });

      it('blocks "legacy issue" pattern', () => {
        const transcriptPath = createTranscript([
          { type: 'user', message: { content: [{ type: 'text', text: 'Should I fix this?' }] } },
          {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'This is just a legacy issue we can ignore.' }],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'ownership-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'legacy',
        });

        cleanupTranscript(transcriptPath);
      });

      it('blocks "CI should now pass" pattern', () => {
        const transcriptPath = createTranscript([
          { type: 'user', message: { content: [{ type: 'text', text: 'Done with the fix.' }] } },
          {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'CI should now pass after my changes.' }] },
          },
        ]);

        const result = executeHookSync({
          hookName: 'ownership-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'CI should now pass',
        });

        cleanupTranscript(transcriptPath);
      });
    });

    describe('pattern in code blocks (should be ignored)', () => {
      it('ignores "pre-existing" when inside backticks', () => {
        const transcriptPath = createTranscript([
          { type: 'user', message: { content: [{ type: 'text', text: 'What went wrong?' }] } },
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'text',
                  text: 'The issue is similar to this `pre-existing` condition in other code.',
                },
              ],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'ownership-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        // Should not block (no JSON decision output)
        expectAllowed(result);
        expect(result.stdout).toBe('');

        cleanupTranscript(transcriptPath);
      });

      it('ignores patterns in multi-line code blocks', () => {
        const transcriptPath = createTranscript([
          { type: 'user', message: { content: [{ type: 'text', text: 'Show me an example.' }] } },
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'text',
                  text: '```typescript\n// This is a legacy issue pattern\nconst legacy = true;\n```',
                },
              ],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'ownership-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        // Should not block
        expectAllowed(result);

        cleanupTranscript(transcriptPath);
      });
    });

    describe('allowed language patterns', () => {
      it('allows ownership-taking language', () => {
        const transcriptPath = createTranscript([
          { type: 'user', message: { content: [{ type: 'text', text: 'What went wrong?' }] } },
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'text',
                  text: 'CI failed with type errors. Fixing them now. The build is failing due to missing dependencies.',
                },
              ],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'ownership-check',
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

      it('allows solution-focused language', { timeout: 25000 }, () => {
        const transcriptPath = createTranscript([
          { type: 'user', message: { content: [{ type: 'text', text: 'What should I do?' }] } },
          {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'text',
                  text: 'Found 3 coverage gaps. Writing tests to resolve. Let me fix the type errors first.',
                },
              ],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'ownership-check',
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
          hookName: 'ownership-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
          },
        });

        expectAllowed(result);
      });

      it('allows when transcript file does not exist', () => {
        const result = executeHookSync({
          hookName: 'ownership-check',
          input: {
            tool_name: 'PostToolUse',
            tool_input: {},
            transcript_path: '/nonexistent/path/transcript.jsonl',
          },
        });

        expectAllowed(result);
      });

      it('allows when transcript has no assistant messages', () => {
        const transcriptPath = createTranscript([
          {
            type: 'user',
            message: { content: [{ type: 'text', text: 'Hello' }] },
          },
        ]);

        const result = executeHookSync({
          hookName: 'ownership-check',
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
                  text: 'This is a PRE-EXISTING condition in the codebase.',
                },
              ],
            },
          },
        ]);

        const result = executeHookSync({
          hookName: 'ownership-check',
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
