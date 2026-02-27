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

function createWorkerTranscript(phase: '1' | '2', assistantMessages: string[]): string {
  const tempDir = path.join(__dirname, 'fixtures', 'temp-files');
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  const transcriptPath = path.join(tempDir, `transcript-${randomUUID()}.jsonl`);

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

  writeFileSync(
    transcriptPath,
    messages.map((msg) => JSON.stringify(msg)).join('\n') + '\n',
    'utf-8'
  );
  return transcriptPath;
}

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

  writeFileSync(
    transcriptPath,
    messages.map((msg) => JSON.stringify(msg)).join('\n') + '\n',
    'utf-8'
  );
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
    it('allows interactive sessions (non-worker mode)', () => {
      const transcriptPath = createInteractiveTranscript(['Done.']);

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

    it('allows when transcript_path is missing', () => {
      const result = executeHookSync({
        hookName: 'completion-validator',
        input: {
          tool_name: 'Stop',
          tool_input: {},
        },
      });

      expectAllowed(result);
    });

    describe('Phase 1 contract', () => {
      it('blocks when PHASE1_FINAL block is missing', () => {
        const transcriptPath = createWorkerTranscript('1', ['I analyzed the issue.']);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
          env: { CLAUDE_WORKER_MODE: '1' },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'PHASE1_FINAL',
        });

        cleanupTranscript(transcriptPath);
      });

      it('blocks when code-task label and readiness mismatch', () => {
        const transcriptPath = createWorkerTranscript('1', [
          `PHASE1_FINAL:\n- Linear label set: code-task\n- Phase 2 ready: no\n- Linear issue: https://linear.app/intexuraos/issue/INT-1\n- Summary: Done`,
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
          env: { CLAUDE_WORKER_MODE: '1' },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'code-task requires Phase 2 ready: yes',
        });

        cleanupTranscript(transcriptPath);
      });

      it('allows valid PHASE1_FINAL block', () => {
        const transcriptPath = createWorkerTranscript('1', [
          `PHASE1_FINAL:\n- Linear label set: code-task\n- Phase 2 ready: yes\n- Linear issue: https://linear.app/intexuraos/issue/INT-1\n- Summary: Ready for implementation`,
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
          env: { CLAUDE_WORKER_MODE: '1' },
        });

        expectAllowed(result);
        cleanupTranscript(transcriptPath);
      });
    });

    describe('Phase 2 contract', () => {
      it('blocks when PR line is missing', () => {
        const transcriptPath = createWorkerTranscript('2', [
          `PHASE2_FINAL:\n- CI evidence: pnpm run ci:tracked successful\n- Linear issue: https://linear.app/intexuraos/issue/INT-2\n- Review iterations: 1\n- Turn summary: Fixed bug | Wrote tests | Review clean | PR ready | Done\n- Summary: Done`,
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
          env: { CLAUDE_WORKER_MODE: '1' },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'PR URL line',
        });

        cleanupTranscript(transcriptPath);
      });

      it('blocks when CI evidence line is invalid', () => {
        const transcriptPath = createWorkerTranscript('2', [
          `PHASE2_FINAL:\n- PR: https://github.com/user/repo/pull/123\n- CI evidence: ci passed\n- Linear issue: https://linear.app/intexuraos/issue/INT-2\n- Review iterations: 1\n- Turn summary: Fixed bug | Wrote tests | Review clean | PR ready | Done\n- Summary: Done`,
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
          env: { CLAUDE_WORKER_MODE: '1' },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'CI evidence line',
        });

        cleanupTranscript(transcriptPath);
      });

      it('blocks when review iterations line is missing', () => {
        const transcriptPath = createWorkerTranscript('2', [
          `PHASE2_FINAL:\n- PR: https://github.com/user/repo/pull/123\n- CI evidence: pnpm run ci:tracked successful\n- Linear issue: https://linear.app/intexuraos/issue/INT-2\n- Turn summary: Fixed bug | Wrote tests | Review clean | PR ready | Done\n- Summary: Done`,
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
          env: { CLAUDE_WORKER_MODE: '1' },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'Review iterations line',
        });

        cleanupTranscript(transcriptPath);
      });

      it('blocks when turn summary line is missing', () => {
        const transcriptPath = createWorkerTranscript('2', [
          `PHASE2_FINAL:\n- PR: https://github.com/user/repo/pull/123\n- CI evidence: pnpm run ci:tracked successful\n- Linear issue: https://linear.app/intexuraos/issue/INT-2\n- Review iterations: 2\n- Summary: Done`,
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
          env: { CLAUDE_WORKER_MODE: '1' },
        });

        expectJsonOutput(result, {
          decision: 'block',
          reasonIncludes: 'Turn summary line',
        });

        cleanupTranscript(transcriptPath);
      });

      it('allows valid PHASE2_FINAL block', () => {
        const transcriptPath = createWorkerTranscript('2', [
          `PHASE2_FINAL:\n- PR: https://github.com/user/repo/pull/123\n- CI evidence: pnpm run ci:tracked successful\n- Linear issue: https://linear.app/intexuraos/issue/INT-2\n- Review iterations: 2\n- Turn summary: Planned auth refactor | Wrote 8 tests | Implemented changes | Review clean after 2 iterations | PR ready\n- Summary: Implemented requested changes`,
        ]);

        const result = executeHookSync({
          hookName: 'completion-validator',
          input: {
            tool_name: 'Stop',
            tool_input: {},
            transcript_path: transcriptPath,
          },
          env: { CLAUDE_WORKER_MODE: '1' },
        });

        expectAllowed(result);
        cleanupTranscript(transcriptPath);
      });
    });

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
  });
});
