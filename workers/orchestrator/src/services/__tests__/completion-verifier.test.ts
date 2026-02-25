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

const loggerInfo = vi.fn();
const loggerWarn = vi.fn();
const loggerError = vi.fn();
const loggerDebug = vi.fn();

const logger: Logger = {
  info: loggerInfo as Logger['info'],
  warn: loggerWarn as Logger['warn'],
  error: loggerError as Logger['error'],
  debug: loggerDebug as Logger['debug'],
};

const defaultConfig = {
  model: LlmModels.Gemini25Flash,
  geminiApiKey: 'gemini-key',
  auditLogPath: '/tmp/orchestrator-llm-audit.test.log',
} as const;

function createVerifier(
  overrides: Partial<{ model: string; geminiApiKey: string; auditLogPath: string }> = {}
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
- Summary: Analyzed the feature request and identified three implementation approaches. Created detailed design with test requirements and acceptance criteria. Published design document. Task is ready for Phase 2 implementation.`;

const validPhase2Final = `PHASE2_FINAL:
- PR: https://github.com/intexuraos/intexuraos/pull/123
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-2
- Review iterations: 2
- Turn summary: Implemented auth middleware fix | Wrote 8 tests covering edge cases | Code review found missing null check — fixed | CI green after review fixes | PR #123 ready for human review
- Summary: Implemented the login redirect fix by updating the auth middleware to preserve return URLs. Added integration tests covering OAuth callback flows. CI passes with full coverage.`;

describe('completion-verifier', () => {
  beforeEach(() => {
    createLlmClientMock.mockReset();
    loggerInfo.mockReset();
    loggerWarn.mockReset();
    loggerError.mockReset();
    loggerDebug.mockReset();
    createLlmClientMock.mockReturnValue({
      generate: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          content:
            '{"passed":true,"confidence":0.95,"reasons":["ok"],"missingCriteria":[],"resumeInstruction":"done","extractedSummary":"Task completed successfully."}',
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

  it('detects missing Review iterations in PHASE2_FINAL', () => {
    const incomplete = `PHASE2_FINAL:
- PR: https://github.com/intexuraos/intexuraos/pull/123
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-2
- Summary: Done`;
    const result = CompletionVerifierTestUtils.verifyPhase2Final(incomplete);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid result');
    expect(result.missing).toContain('Review iterations line');
  });

  it('detects missing Turn summary in PHASE2_FINAL', () => {
    const incomplete = `PHASE2_FINAL:
- PR: https://github.com/intexuraos/intexuraos/pull/123
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-2
- Review iterations: 2
- Summary: Done`;
    const result = CompletionVerifierTestUtils.verifyPhase2Final(incomplete);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid result');
    expect(result.missing).toContain('Turn summary line');
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

  it('builds phase-specific default resume instructions', () => {
    const phase1Instruction = CompletionVerifierTestUtils.buildDefaultResumeInstruction('phase1', [
      'missing-criteria',
    ]);
    const phase2Instruction = CompletionVerifierTestUtils.buildDefaultResumeInstruction('phase2', [
      'missing-criteria',
    ]);

    expect(phase1Instruction).toContain('PHASE1_FINAL');
    expect(phase2Instruction).toContain('PHASE2_FINAL');
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
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        attempt: 1,
        phase: 'phase1',
        promptChars: expect.any(Number),
      }),
      'Gemini completion verifier request'
    );
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        attempt: 1,
        responseChars: expect.any(Number),
      }),
      'Gemini completion verifier response'
    );
  });

  it('still invokes Gemini when deterministic signals indicate explicit worker errors', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":false,"confidence":0.96,"reasons":["model observed task failure"],"missingCriteria":["Fix runtime errors"],"resumeInstruction":"Resolve errors and continue."}',
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
    expect(verdict.usedLlm).toBe(true);
    expect(verdict.reasons.join(' ')).toContain('explicit error');
    expect(verdict.reasons.join(' ')).toContain('non-zero');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('does not deterministically fail when tool_use_error is present without other errors', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":true,"confidence":0.90,"reasons":["task completed despite sibling tool error"],"missingCriteria":[],"resumeInstruction":"No action needed"}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-tool-use-error-only',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase1',
      originalPrompt: 'Analyze issue',
      rawLogs: `<tool_use_error>Sibling tool call errored</tool_use_error>\n${assistantLog(validPhase1Final)}`,
      linearIssueLabels: [],
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.usedLlm).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('does not include hasToolUseError signal in Gemini prompt', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":true,"confidence":0.92,"reasons":["contract met despite sibling tool error"],"missingCriteria":[],"resumeInstruction":""}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-tool-error-no-signal',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase1',
      originalPrompt: 'Analyze issue',
      rawLogs: `<tool_use_error>Sibling tool call errored</tool_use_error>\n${assistantLog(validPhase1Final)}`,
      linearIssueLabels: [],
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.usedLlm).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0]).not.toContain('hasToolUseError');
  });

  it('still invokes Gemini when assistant final message is missing', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":false,"confidence":0.41,"reasons":["assistant response missing"],"missingCriteria":["Assistant final message"],"resumeInstruction":"Provide a final completion block."}',
      },
    });
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
    expect(verdict.usedLlm).toBe(true);
    expect(verdict.missingCriteria).toContain('Assistant final message');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('still invokes Gemini when phase1 contract checks fail deterministically', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":false,"confidence":0.88,"reasons":["phase contract mismatch"],"missingCriteria":["code-task requires Phase 2 ready: yes"],"resumeInstruction":"Fix PHASE1_FINAL consistency."}',
      },
    });
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
    expect(verdict.usedLlm).toBe(true);
    expect(verdict.missingCriteria).toContain('code-task requires Phase 2 ready: yes');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('fails phase2 when PR URL is missing from task result', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":false,"confidence":0.93,"reasons":["missing PR evidence"],"missingCriteria":["PR URL created from branch"],"resumeInstruction":"Create PR and provide PHASE2_FINAL evidence."}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });
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
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('fails phase2 when PR targets wrong base branch', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":false,"confidence":0.95,"reasons":["PR targets wrong base branch"],"missingCriteria":["PR targeting base branch \\"development\\""],"resumeInstruction":"Create PR targeting the correct base branch."}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });
    const verifier = createVerifier();

    // Task expects PR to target 'development' but PR targets 'main'
    const verdict = await verifier.verify({
      taskId: 'task-wrong-base-branch',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase2',
      originalPrompt: 'Implement and open PR targeting development',
      rawLogs: assistantLog(validPhase2Final),
      linearIssueLabels: ['code-task'],
      baseBranch: 'development',
      taskResult: {
        branch: 'feature/fix',
        baseBranch: 'main', // Wrong - should be 'development'
        prUrl: 'https://github.com/intexuraos/intexuraos/pull/125',
        commits: 3,
        ciFailed: false,
      },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('main');
    expect(verdict.reasons.join(' ')).toContain('development');
    expect(verdict.missingCriteria.join(' ')).toContain('development');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('passes phase2 when PR targets correct base branch', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":true,"confidence":0.98,"reasons":["all criteria met"],"missingCriteria":[],"resumeInstruction":"done"}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });
    const verifier = createVerifier();

    // Task expects PR to target 'development' and PR targets 'development'
    const verdict = await verifier.verify({
      taskId: 'task-correct-base-branch',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase2',
      originalPrompt: 'Implement and open PR targeting development',
      rawLogs: assistantLog(validPhase2Final),
      linearIssueLabels: ['code-task'],
      baseBranch: 'development',
      taskResult: {
        branch: 'feature/fix',
        baseBranch: 'development', // Correct
        prUrl: 'https://github.com/intexuraos/intexuraos/pull/126',
        commits: 3,
        ciFailed: false,
      },
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.usedLlm).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('still invokes Gemini when phase2 contract checks fail deterministically', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":false,"confidence":0.77,"reasons":["missing CI evidence"],"missingCriteria":["CI evidence line"],"resumeInstruction":"Run ci:tracked and add evidence line."}',
      },
    });
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
    expect(verdict.usedLlm).toBe(true);
    expect(verdict.missingCriteria).toContain('CI evidence line');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('fails phase2 when GitHub checks are failing', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":false,"confidence":0.9,"reasons":["ci checks failing"],"missingCriteria":["Successful GitHub checks for PR branch"],"resumeInstruction":"Fix CI failures and rerun checks."}',
      },
    });
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
    expect(verdict.usedLlm).toBe(true);
    expect(verdict.missingCriteria).toContain('Successful GitHub checks for PR branch');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('fails phase2 when CI status is unknown', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":false,"confidence":0.82,"reasons":["ci state unknown"],"missingCriteria":["Confirmed GitHub checks status"],"resumeInstruction":"Determine CI status and report it explicitly."}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });
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
    expect(generate).toHaveBeenCalledTimes(1);
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

  it('marks verifier failure when Gemini call returns provider error', async () => {
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
    expect(verdict.reasons.join(' ')).toContain('Gemini verifier unavailable');
    expect(verdict.verifierFailure).toBe(true);
    expect(verdict.resumeInstruction).toContain('PHASE1_FINAL');
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-llm-error',
        attempt: 1,
        errorCode: 'RATE_LIMITED',
      }),
      'Gemini completion verifier returned no response'
    );
  });

  it('builds phase2-specific retry instruction when Gemini call fails in phase2', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'provider unavailable' },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-llm-error-phase2',
      attempt: 2,
      maxAttempts: 3,
      phase: 'phase2',
      originalPrompt: 'Implement and open PR',
      rawLogs: assistantLog(validPhase2Final),
      linearIssueLabels: ['code-task'],
      taskResult: {
        branch: 'task',
        commits: 2,
        prUrl: 'https://github.com/intexuraos/intexuraos/pull/125',
        ciFailed: false,
      },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.verifierFailure).toBe(true);
    expect(verdict.resumeInstruction).toContain('PHASE2_FINAL');
  });

  it('marks verifier failure when Gemini returns invalid JSON', async () => {
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
    expect(verdict.missingCriteria).toContain('Gemini verifier response');
    expect(verdict.verifierFailure).toBe(true);
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-llm-invalid-json',
        attempt: 1,
        response: 'this is not json',
      }),
      'Gemini completion verifier response parsing failed'
    );
  });

  it('accepts empty resumeInstruction when Gemini returns passed verdict', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":true,"confidence":0.97,"reasons":["all criteria met"],"missingCriteria":[],"resumeInstruction":""}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-empty-resume',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase1',
      originalPrompt: 'Prepare issue',
      rawLogs: assistantLog(validPhase1Final),
      linearIssueLabels: [],
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.resumeInstruction).toBe('');
    expect(verdict.verifierFailure).toBe(false);
    expect(verdict.usedLlm).toBe(true);
  });

  it('propagates extractedSummary from Gemini verdict', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":true,"confidence":0.95,"reasons":["all good"],"missingCriteria":[],"resumeInstruction":"","extractedSummary":"Analyzed the issue and enriched the Linear description. Added test requirements and acceptance criteria. Set code-task label for Phase 2."}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-summary',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase1',
      originalPrompt: 'Prepare issue',
      rawLogs: assistantLog(validPhase1Final),
      linearIssueLabels: [],
    });

    expect(verdict.extractedSummary).toBe(
      'Analyzed the issue and enriched the Linear description. Added test requirements and acceptance criteria. Set code-task label for Phase 2.'
    );
  });

  it('returns undefined extractedSummary when Gemini omits it', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":true,"confidence":0.91,"reasons":["ok"],"missingCriteria":[],"resumeInstruction":""}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-no-summary',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase1',
      originalPrompt: 'Prepare issue',
      rawLogs: assistantLog(validPhase1Final),
      linearIssueLabels: [],
    });

    expect(verdict.extractedSummary).toBeUndefined();
  });

  it('returns undefined extractedSummary when Gemini returns empty string', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":true,"confidence":0.91,"reasons":["ok"],"missingCriteria":[],"resumeInstruction":"","extractedSummary":""}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-empty-summary',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase1',
      originalPrompt: 'Prepare issue',
      rawLogs: assistantLog(validPhase1Final),
      linearIssueLabels: [],
    });

    expect(verdict.extractedSummary).toBeUndefined();
  });

  it('does not include extractedSummary when Gemini verifier fails', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'rate limited' },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-verifier-fail-summary',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase1',
      originalPrompt: 'Prepare issue',
      rawLogs: assistantLog(validPhase1Final),
      linearIssueLabels: [],
    });

    expect(verdict.extractedSummary).toBeUndefined();
    expect(verdict.verifierFailure).toBe(true);
  });

  it('detects malformed pr-comment contract', () => {
    const result = CompletionVerifierTestUtils.verifyPRCommentFinal('No completion block');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid pr-comment result');
    expect(result.missing).toContain('PR_COMMENT_FINAL block');
  });

  it('validates valid PR_COMMENT_FINAL block', () => {
    const validPRCommentFinal = `PR_COMMENT_FINAL:
- PR: https://github.com/intexuraos/intexuraos/pull/42
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-100
- Comment replied: yes
- Summary: Investigated PR comment requesting auth fix. Implemented changes to middleware. CI passes. Pushed to existing branch and replied to commenter.`;

    const result = CompletionVerifierTestUtils.verifyPRCommentFinal(validPRCommentFinal);
    expect(result.ok).toBe(true);
  });

  it('detects missing Comment replied line in PR_COMMENT_FINAL', () => {
    const missingCommentReply = `PR_COMMENT_FINAL:
- PR: https://github.com/intexuraos/intexuraos/pull/42
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-100
- Summary: Did some work.`;

    const result = CompletionVerifierTestUtils.verifyPRCommentFinal(missingCommentReply);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid result');
    expect(result.missing).toContain('Comment replied line');
  });

  it('builds pr-comment-specific default resume instruction', () => {
    const instruction = CompletionVerifierTestUtils.buildDefaultResumeInstruction('pr-comment', [
      'missing-criteria',
    ]);

    expect(instruction).toContain('PR_COMMENT_FINAL');
    expect(instruction).toContain('Push changes');
    expect(instruction).toContain('reply to the comment');
  });

  it('fails pr-comment when PR_COMMENT_FINAL block is missing from assistant message', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":false,"confidence":0.85,"reasons":["missing PR_COMMENT_FINAL"],"missingCriteria":["PR_COMMENT_FINAL block"],"resumeInstruction":"Add PR_COMMENT_FINAL block."}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-pr-comment-missing-block',
      attempt: 1,
      maxAttempts: 3,
      phase: 'pr-comment',
      originalPrompt: 'Address PR comment',
      rawLogs: assistantLog('I fixed the bug. Done!'),
      linearIssueLabels: ['code-task', 'pr-comment'],
      taskResult: {
        branch: 'fix/auth',
        commits: 1,
        ciFailed: false,
      },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.missingCriteria).toContain('PR_COMMENT_FINAL block');
    expect(verdict.reasons.join(' ')).toContain('PR Comment completion contract was not met');
  });

  it('passes valid pr-comment contract through full verify flow', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":true,"confidence":0.93,"reasons":["all criteria met"],"missingCriteria":[],"resumeInstruction":"","extractedSummary":"Addressed PR comment."}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const validPRCommentFinal = `PR_COMMENT_FINAL:
- PR: https://github.com/intexuraos/intexuraos/pull/42
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-100
- Comment replied: yes
- Summary: Addressed the PR comment by implementing the requested fix. CI passes.`;

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-pr-comment',
      attempt: 1,
      maxAttempts: 3,
      phase: 'pr-comment',
      originalPrompt: 'Address PR comment',
      rawLogs: assistantLog(validPRCommentFinal),
      linearIssueLabels: ['code-task', 'pr-comment'],
      taskResult: {
        branch: 'fix/auth',
        commits: 1,
        prUrl: 'https://github.com/intexuraos/intexuraos/pull/42',
        ciFailed: false,
      },
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.usedLlm).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0]).toContain('PR_COMMENT_FINAL');
    expect(generate.mock.calls[0]?.[0]).not.toContain('PHASE2_FINAL');
  });

  it('fails pr-comment when CI checks are failing', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":false,"confidence":0.9,"reasons":["ci failing"],"missingCriteria":["Successful GitHub checks"],"resumeInstruction":"Fix CI."}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const validPRCommentFinal = `PR_COMMENT_FINAL:
- PR: https://github.com/intexuraos/intexuraos/pull/42
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-100
- Comment replied: yes
- Summary: Attempted fix but CI fails.`;

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-pr-comment-ci-fail',
      attempt: 1,
      maxAttempts: 3,
      phase: 'pr-comment',
      originalPrompt: 'Address PR comment',
      rawLogs: assistantLog(validPRCommentFinal),
      linearIssueLabels: ['code-task', 'pr-comment'],
      taskResult: {
        branch: 'fix/auth',
        commits: 1,
        ciFailed: true,
      },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.missingCriteria.join(' ')).toContain('GitHub checks');
  });

  it('builds pr-comment retry instruction when Gemini call fails', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'provider unavailable' },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const validPRCommentFinal = `PR_COMMENT_FINAL:
- PR: https://github.com/intexuraos/intexuraos/pull/42
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-100
- Comment replied: yes
- Summary: Done.`;

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-pr-comment-llm-fail',
      attempt: 1,
      maxAttempts: 3,
      phase: 'pr-comment',
      originalPrompt: 'Address PR comment',
      rawLogs: assistantLog(validPRCommentFinal),
      linearIssueLabels: ['code-task', 'pr-comment'],
      taskResult: {
        branch: 'fix/auth',
        commits: 1,
        prUrl: 'https://github.com/intexuraos/intexuraos/pull/42',
        ciFailed: false,
      },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.verifierFailure).toBe(true);
    expect(verdict.resumeInstruction).toContain('PR_COMMENT_FINAL');
  });

  it('fails pr-comment when CI status is unknown', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":false,"confidence":0.82,"reasons":["ci state unknown"],"missingCriteria":["Confirmed GitHub checks status"],"resumeInstruction":"Determine CI status."}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const validPRCommentFinal = `PR_COMMENT_FINAL:
- PR: https://github.com/intexuraos/intexuraos/pull/42
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-100
- Comment replied: yes
- Summary: Done.`;

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-pr-comment-ci-unknown',
      attempt: 1,
      maxAttempts: 3,
      phase: 'pr-comment',
      originalPrompt: 'Address PR comment',
      rawLogs: assistantLog(validPRCommentFinal),
      linearIssueLabels: ['code-task', 'pr-comment'],
      taskResult: {
        branch: 'fix/auth',
        commits: 1,
      },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.missingCriteria.join(' ')).toContain('GitHub checks status');
  });

  it('coerces null resumeInstruction and extractedSummary from Gemini to safe defaults', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":true,"confidence":0.93,"reasons":["all good"],"missingCriteria":[],"resumeInstruction":null,"extractedSummary":null}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-null-fields',
      attempt: 1,
      maxAttempts: 3,
      phase: 'phase1',
      originalPrompt: 'Prepare issue',
      rawLogs: assistantLog(validPhase1Final),
      linearIssueLabels: [],
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.resumeInstruction).toBe('');
    expect(verdict.extractedSummary).toBeUndefined();
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

  it('throws when audit log path is an empty string', () => {
    expect(() => createVerifier({ auditLogPath: '' })).toThrow(
      'Completion verifier auditLogPath is required'
    );
  });
});
