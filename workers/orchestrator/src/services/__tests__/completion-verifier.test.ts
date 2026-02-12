import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { LlmModels } from '@intexuraos/llm-contract';

const { createLlmClientMock } = vi.hoisted(() => ({
  createLlmClientMock: vi.fn(),
}));

vi.mock('@intexuraos/llm-factory', () => ({
  createLlmClient: createLlmClientMock,
}));

const { OrchestratorCompletionVerifier, CompletionVerifierTestUtils } =
  await import('../completion-verifier.js');

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const defaultConfig = {
  model: LlmModels.Gemini25Flash,
  geminiApiKey: 'gemini-key',
} as const;

function createVerifier(
  overrides: Partial<{ model: string; geminiApiKey: string }> = {}
): InstanceType<typeof OrchestratorCompletionVerifier> {
  return new OrchestratorCompletionVerifier(logger, { ...defaultConfig, ...overrides });
}

function assistantLog(text: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'text', text }],
    },
  });
}

const validPhase1Final = `PHASE1_FINAL:
- Linear label set: code-task
- Phase 2 ready: yes
- Linear issue: https://linear.app/intexuraos/issue/INT-1
- Summary: Ready`;

const validPhase2Final = `PHASE2_FINAL:
- PR: https://github.com/intexuraos/intexuraos/pull/123
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-2
- Summary: Done`;

describe('completion-verifier', () => {
  beforeEach(() => {
    createLlmClientMock.mockReset();
    createLlmClientMock.mockReturnValue({
      generate: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          content:
            '{"passed":true,"confidence":0.95,"reasons":["ok"],"missingCriteria":[],"resumeInstruction":"done"}',
        },
      }),
    });
  });

  it('extracts the last assistant text from mixed logs', () => {
    const rawLogs = [
      'not json',
      '{"type":"result","is_error":false}',
      assistantLog('First response'),
      '{"malformed"',
      assistantLog('Second response'),
    ].join('\n');

    expect(CompletionVerifierTestUtils.extractLastAssistantMessage(rawLogs)).toBe(
      'Second response'
    );
  });

  it('extracts last assistant text while skipping blank and malformed assistant chunks', () => {
    const rawLogs = [
      '',
      '   ',
      '{"type":"assistant","message":{}}',
      assistantLog('   '),
      assistantLog('Final response'),
    ].join('\n');

    expect(CompletionVerifierTestUtils.extractLastAssistantMessage(rawLogs)).toBe('Final response');
  });

  it('detects malformed phase1 and phase2 contracts', () => {
    const phase1 = CompletionVerifierTestUtils.verifyPhase1Final('No completion block');
    expect(phase1.ok).toBe(false);
    if (phase1.ok) throw new Error('Expected invalid phase1 result');
    expect(phase1.missing).toContain('PHASE1_FINAL block');

    const phase2 = CompletionVerifierTestUtils.verifyPhase2Final('No phase two block');
    expect(phase2.ok).toBe(false);
    if (phase2.ok) throw new Error('Expected invalid phase2 result');
    expect(phase2.missing).toContain('PHASE2_FINAL block');
  });

  it('detects inconsistent phase1 label and readiness combinations', () => {
    const codeTaskMismatch = CompletionVerifierTestUtils.verifyPhase1Final(`PHASE1_FINAL:
- Linear label set: code-task
- Phase 2 ready: no
- Linear issue: https://linear.app/intexuraos/issue/INT-1
- Summary: mismatch`);
    expect(codeTaskMismatch.ok).toBe(false);
    if (codeTaskMismatch.ok) throw new Error('Expected invalid code-task mismatch');
    expect(codeTaskMismatch.missing).toContain('code-task requires Phase 2 ready: yes');

    const unclearMismatch = CompletionVerifierTestUtils.verifyPhase1Final(`PHASE1_FINAL:
- Linear label set: unclear
- Phase 2 ready: yes
- Linear issue: https://linear.app/intexuraos/issue/INT-1
- Summary: mismatch`);
    expect(unclearMismatch.ok).toBe(false);
    if (unclearMismatch.ok) throw new Error('Expected invalid unclear mismatch');
    expect(unclearMismatch.missing).toContain('unclear requires Phase 2 ready: no');
  });

  it('always reports enabled gemini verifier', () => {
    const verifier = createVerifier();
    expect(verifier.describe()).toEqual({
      enabled: true,
      provider: 'gemini',
      model: LlmModels.Gemini25Flash,
    });
  });

  it('passes valid phase1 contract and uses LLM adjudication', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":true,"confidence":0.91,"reasons":["all good"],"missingCriteria":[],"resumeInstruction":"No action"}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-1',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase1',
      originalPrompt: 'Prepare issue',
      rawLogs: assistantLog(validPhase1Final),
      linearIssueLabels: [],
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.usedLlm).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0]).toContain('PHASE1_FINAL');
  });

  it('fails deterministic checks before LLM on explicit worker errors', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":true,"confidence":0.95,"reasons":["ok"],"missingCriteria":[],"resumeInstruction":"done"}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-error',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase1',
      originalPrompt: 'Analyze issue',
      rawLogs: `<tool_use_error>File does not exist</tool_use_error>\n${assistantLog(validPhase1Final)}`,
      linearIssueLabels: [],
      claudeError: 'upstream failure',
      workerExitCode: 17,
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.usedLlm).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('explicit error');
    expect(verdict.reasons.join(' ')).toContain('non-zero');
    expect(generate).not.toHaveBeenCalled();
  });

  it('fails deterministic checks when assistant final message is missing', async () => {
    const generate = vi.fn();
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-no-assistant',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase1',
      originalPrompt: 'Analyze issue',
      rawLogs: '{"type":"result","is_error":false}',
      linearIssueLabels: [],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.usedLlm).toBe(false);
    expect(verdict.missingCriteria).toContain('Assistant final message');
    expect(generate).not.toHaveBeenCalled();
  });

  it('fails deterministic phase1 contract checks before LLM', async () => {
    const generate = vi.fn();
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-phase1-mismatch',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase1',
      originalPrompt: 'Analyze issue',
      rawLogs: assistantLog(`PHASE1_FINAL:
- Linear label set: code-task
- Phase 2 ready: no
- Linear issue: https://linear.app/intexuraos/issue/INT-1
- Summary: mismatch`),
      linearIssueLabels: [],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.usedLlm).toBe(false);
    expect(verdict.missingCriteria).toContain('code-task requires Phase 2 ready: yes');
    expect(generate).not.toHaveBeenCalled();
  });

  it('fails phase2 when PR URL is missing from task result', async () => {
    const verifier = createVerifier();

    const verdict = await verifier.verify({
      taskId: 'task-missing-pr',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase2',
      originalPrompt: 'Implement and open PR',
      rawLogs: assistantLog(validPhase2Final),
      linearIssueLabels: ['code-task'],
      taskResult: {
        branch: 'task',
        commits: 2,
        ciFailed: false,
      },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.missingCriteria.join(' ')).toContain('PR URL');
  });

  it('fails deterministic phase2 contract checks before LLM', async () => {
    const generate = vi.fn();
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-phase2-missing-ci-line',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase2',
      originalPrompt: 'Implement and open PR',
      rawLogs: assistantLog(`PHASE2_FINAL:
- PR: https://github.com/intexuraos/intexuraos/pull/123
- Linear issue: https://linear.app/intexuraos/issue/INT-2
- Summary: Done`),
      linearIssueLabels: ['code-task'],
      taskResult: {
        branch: 'task',
        commits: 2,
        prUrl: 'https://github.com/intexuraos/intexuraos/pull/123',
        ciFailed: false,
      },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.usedLlm).toBe(false);
    expect(verdict.missingCriteria).toContain('CI evidence line');
    expect(generate).not.toHaveBeenCalled();
  });

  it('fails phase2 when GitHub checks are failing', async () => {
    const generate = vi.fn();
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-phase2-ci-failed',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase2',
      originalPrompt: 'Implement and open PR',
      rawLogs: assistantLog(validPhase2Final),
      linearIssueLabels: ['code-task'],
      taskResult: {
        branch: 'task',
        commits: 2,
        prUrl: 'https://github.com/intexuraos/intexuraos/pull/124',
        ciFailed: true,
      },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.usedLlm).toBe(false);
    expect(verdict.missingCriteria).toContain('Successful GitHub checks for PR branch');
    expect(generate).not.toHaveBeenCalled();
  });

  it('fails phase2 when CI status is unknown', async () => {
    const verifier = createVerifier();

    const verdict = await verifier.verify({
      taskId: 'task-ci-unknown',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase2',
      originalPrompt: 'Implement and open PR',
      rawLogs: assistantLog(validPhase2Final),
      linearIssueLabels: ['code-task'],
      taskResult: {
        branch: 'task',
        commits: 2,
        prUrl: 'https://github.com/intexuraos/intexuraos/pull/124',
      },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.missingCriteria.join(' ')).toContain('GitHub checks status');
  });

  it('parses wrapped JSON from LLM output', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          'Verifier result:\n{"passed":false,"confidence":0.4,"reasons":["missing"],"missingCriteria":["criterion"],"resumeInstruction":"Do X"}\nthanks',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-llm-wrap',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase2',
      originalPrompt: 'Implement and open PR',
      rawLogs: assistantLog(validPhase2Final),
      linearIssueLabels: ['code-task'],
      taskResult: {
        branch: 'task',
        commits: 1,
        prUrl: 'https://github.com/intexuraos/intexuraos/pull/123',
        ciFailed: false,
      },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.usedLlm).toBe(true);
  });

  it('fails with retry guidance when LLM call returns provider error', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'rate limited' },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-llm-error',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase1',
      originalPrompt: 'Prepare issue',
      rawLogs: assistantLog(validPhase1Final),
      linearIssueLabels: [],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('LLM verifier failed');
    expect(verdict.resumeInstruction).toContain('PHASE1_FINAL');
  });

  it('fails with retry guidance when LLM returns invalid JSON', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: { content: 'this is not json' },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-llm-invalid-json',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase1',
      originalPrompt: 'Prepare issue',
      rawLogs: assistantLog(validPhase1Final),
      linearIssueLabels: [],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.missingCriteria).toContain('LLM verifier could not confirm completion');
  });

  it('throws when model is not gemini-2.5-flash', () => {
    expect(() => createVerifier({ model: 'unsupported-model' })).toThrow(
      'Completion verifier must use model gemini-2.5-flash'
    );
  });

  it('throws when gemini verifier key is an empty string', () => {
    expect(() => createVerifier({ geminiApiKey: '' })).toThrow(
      'INTEXURAOS_GEMINI_APP_API_KEY is required'
    );
  });
});
