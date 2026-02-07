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
 * Creates a temporary transcript file in JSONL format for testing completion-validator
 * Includes WORKER-MODE and PHASE markers in system prompt message
 */
function createWorkerTranscript(phase: '1' | '2', assistantMessages: string[]): string {
  const tempDir = path.join(__dirname, 'fixtures', 'temp-files');
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const transcriptPath = path.join(tempDir, `transcript-${randomUUID()}.jsonl`);

  // Create messages array with system prompt containing markers
  const messages = [
    {
      type: 'user',
      message: {
        content: [
          {
            type: 'text',
            text: `[SYSTEM CONTEXT]\nYou are a Claude Code worker.\n[WORKER-MODE]\n[PHASE:${phase}]\nTask ID: test-123`,
          },
        ],
      },
    },
    ...assistantMessages.map((text) => ({
      type: 'assistant',
      message: { content: [{ type: 'text', text }] },
    })),
  ];

  const lines = messages.map((msg) => JSON.stringify(msg)).join('\n');
  writeFileSync(transcriptPath, lines + '\n', 'utf-8');

  return transcriptPath;
}

/**
 * Creates a non-worker transcript (no WORKER-MODE marker)
 */
function createInteractiveTranscript(assistantMessages: string[]): string {
  const tempDir = path.join(__dirname, 'fixtures', 'temp-files');
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const transcriptPath = path.join(tempDir, `transcript-${randomUUID()}.jsonl`);

  const messages = [
    {
      type: 'user',
      message: { content: [{ type: 'text', text: 'Hello, help me with a task' }] },
    },
    ...assistantMessages.map((text) => ({
      type: 'assistant',
      message: { content: [{ type: 'text', text }] },
    })),
  ];

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

describe.sequential('Claude Hooks - Completion Validator', () => {
  beforeEach(() => {
    clearHooksLog();
  });

  describe('completion-validator.sh', () => {
    describe('skips non-worker sessions', () => {
      it('allows interactive sessions (no WORKER-MODE marker)', () => {
        const transcriptPath = createInteractiveTranscript([
          'I completed the task without adding any labels.',
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectAllowed(result);
        // Canary echo fires for all sessions, not just worker mode
        expect(result.stdout).toContain('[HOOK-CANARY]');

        cleanupTranscript(transcriptPath);
      });

      it('allows when transcript_path is not provided', () => {
        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
          },
        });

        expectAllowed(result);
      });
    });

    describe('Phase 1 validation', () => {
      it('blocks when no label mentioned in Phase 1', () => {
        const transcriptPath = createWorkerTranscript('1', [
          'I analyzed the issue and created a design document.',
          'The design is complete. Stopping now.',
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'code-task',
        });

        cleanupTranscript(transcriptPath);
      });

      it('allows when code-task label is mentioned as added', () => {
        const transcriptPath = createWorkerTranscript('1', [
          'I analyzed the issue and created a design document.',
          'Added the code-task label to the Linear issue.',
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectAllowed(result);

        cleanupTranscript(transcriptPath);
      });

      it('allows when unclear label is mentioned as added', () => {
        const transcriptPath = createWorkerTranscript('1', [
          'The requirements are ambiguous and need clarification.',
          'Added unclear label to the issue for human review.',
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectAllowed(result);

        cleanupTranscript(transcriptPath);
      });
    });

    describe('Phase 2 validation', () => {
      it('blocks when PR not mentioned in Phase 2', () => {
        const transcriptPath = createWorkerTranscript('2', [
          'CI passed. Linear updated to In Review.',
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'PR',
        });

        cleanupTranscript(transcriptPath);
      });

      it('blocks when CI passed not mentioned in Phase 2', () => {
        const transcriptPath = createWorkerTranscript('2', [
          'PR created: https://github.com/user/repo/pull/123',
          'Linear updated to In Review.',
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'CI',
        });

        cleanupTranscript(transcriptPath);
      });

      it('blocks when Linear update not mentioned in Phase 2', () => {
        const transcriptPath = createWorkerTranscript('2', [
          'PR created: https://github.com/user/repo/pull/123',
          'CI passed. All tests passing.',
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'Linear',
        });

        cleanupTranscript(transcriptPath);
      });

      it('allows when all artifacts mentioned in Phase 2', () => {
        const transcriptPath = createWorkerTranscript('2', [
          'PR created: https://github.com/user/repo/pull/123',
          'CI passed. All tests passing.',
          'Linear updated to In Review.',
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectAllowed(result);

        cleanupTranscript(transcriptPath);
      });

      it('allows alternative PR format (PR #XXX)', () => {
        const transcriptPath = createWorkerTranscript('2', [
          'PR #456 created successfully.',
          'CI passed.',
          'Linear state: In Review.',
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectAllowed(result);

        cleanupTranscript(transcriptPath);
      });

      it('allows alternative CI format (ci:tracked passed)', () => {
        const transcriptPath = createWorkerTranscript('2', [
          'PR created: https://github.com/user/repo/pull/123',
          'pnpm run ci:tracked passed.',
          'Updated Linear to In Review.',
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectAllowed(result);

        cleanupTranscript(transcriptPath);
      });
    });

    describe('edge cases', () => {
      it('allows when transcript file does not exist', () => {
        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: '/nonexistent/path/transcript.jsonl',
          },
        });

        expectAllowed(result);
      });

      it('allows when transcript has no assistant messages', () => {
        const tempDir = path.join(__dirname, 'fixtures', 'temp-files');
        if (!existsSync(tempDir)) {
          mkdirSync(tempDir, { recursive: true });
        }

        const transcriptPath = path.join(tempDir, `transcript-${randomUUID()}.jsonl`);
        const messages = [
          {
            type: 'user',
            message: {
              content: [{ type: 'text', text: '[WORKER-MODE]\n[PHASE:2]\nTask prompt' }],
            },
          },
        ];
        writeFileSync(transcriptPath, messages.map((m) => JSON.stringify(m)).join('\n') + '\n');

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
        });

        expectAllowed(result);

        cleanupTranscript(transcriptPath);
      });
    });
  });
});
