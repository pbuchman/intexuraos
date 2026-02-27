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

const validPhase1Final = `PLANNING_AGENT_FINAL:
- Outcome: planned
- superpowers_writing_plans_used: 1
- Original issue: https://linear.app/intexuraos/issue/INT-1
- Planning issue: https://linear.app/intexuraos/issue/INT-10
- Trivial task: 0
- Parallel breakdown proof: Split work across orchestrator and code-agent streams
- Plan doc: docs/plans/test-plan.md
- Planning PR: https://github.com/intexuraos/intexuraos/pull/321
- Clarification message:
- Summary: Analyzed the feature request and identified three implementation approaches. Created detailed design with test requirements and acceptance criteria. Published design document. Task is ready for execution.`;

const validPhase2Final = `EXECUTION_AGENT_FINAL:
- Outcome: implemented
- PR: https://github.com/intexuraos/intexuraos/pull/123
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-2
- Review iterations: 2
- superpowers_executing_plans_used: 1
- superpowers_requesting_code_review_used: 1
- trivial_task: 0
- subagents: backend-implementer (auth middleware fix), qa-reviewer (review loop + CI verification)
- Skill sequence proof: Started with superpowers:executing-plans, then ran superpowers:requesting-code-review after PR creation
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

  it('returns null when no assistant messages are present', () => {
    const rawLogs = [
      '{"type":"result","is_error":false}',
      '{"type":"user","message":{"content":[{"type":"text","text":"hello"}]}}',
    ].join('\n');

    expect(CompletionVerifierTestUtils.extractLastAssistantMessage(rawLogs)).toBeNull();
  });

  it('detects malformed planning-agent and execution-agent contracts', () => {
    const planningResult =
      CompletionVerifierTestUtils.verifyPlanningAgentFinal('No completion block');
    expect(planningResult.ok).toBe(false);
    if (planningResult.ok) throw new Error('Expected invalid planning-agent result');
    expect(planningResult.missing).toContain('PLANNING_AGENT_FINAL block');

    const executionResult =
      CompletionVerifierTestUtils.verifyExecutionAgentFinal('No execution block');
    expect(executionResult.ok).toBe(false);
    if (executionResult.ok) throw new Error('Expected invalid execution-agent result');
    expect(executionResult.missing).toContain('EXECUTION_AGENT_FINAL block');
  });

  it('detects missing Review iterations in EXECUTION_AGENT_FINAL', () => {
    const incomplete = `EXECUTION_AGENT_FINAL:
- PR: https://github.com/intexuraos/intexuraos/pull/123
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-2
- Summary: Done`;
    const result = CompletionVerifierTestUtils.verifyExecutionAgentFinal(incomplete);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid result');
    expect(result.missing).toContain('Review iterations line');
  });

  it('detects missing execution-agent proof fields in EXECUTION_AGENT_FINAL', () => {
    const incomplete = `EXECUTION_AGENT_FINAL:
- Outcome: implemented
- PR: https://github.com/intexuraos/intexuraos/pull/123
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-2
- Review iterations: 2
- Summary: Done`;
    const result = CompletionVerifierTestUtils.verifyExecutionAgentFinal(incomplete);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid result');
    expect(result.missing).toContain('superpowers_executing_plans_used line');
  });

  it('accepts valid execution-agent final block in deterministic helper', () => {
    const result = CompletionVerifierTestUtils.verifyExecutionAgentFinal(validPhase2Final);
    expect(result.ok).toBe(true);
  });

  it('detects multiple missing execution-agent proof fields in EXECUTION_AGENT_FINAL', () => {
    const incomplete = `EXECUTION_AGENT_FINAL:
- Outcome: implemented
- PR: https://github.com/intexuraos/intexuraos/pull/123
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-2
- Review iterations: 2
- Summary: Done`;
    const result = CompletionVerifierTestUtils.verifyExecutionAgentFinal(incomplete);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid result');
    expect(result.missing).toContain('superpowers_executing_plans_used line');
    expect(result.missing).toContain('superpowers_requesting_code_review_used line');
    expect(result.missing).toContain('trivial_task line');
    expect(result.missing).toContain('subagents line');
    expect(result.missing).toContain('Skill sequence proof line');
  });

  it('treats blank execution fields as missing and rejects malformed URLs', () => {
    const malformed = `EXECUTION_AGENT_FINAL:
- Outcome: implemented
- PR: not-a-url
- CI evidence: pnpm run ci:tracked successful
- Linear issue: INT-2
- Review iterations: 2
- superpowers_executing_plans_used: 1
- superpowers_requesting_code_review_used: 1
- trivial_task: 0
- subagents:
- Skill sequence proof: superpowers:executing-plans -> superpowers:requesting-code-review
- Summary: Done`;
    const result = CompletionVerifierTestUtils.verifyExecutionAgentFinal(malformed);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid result');
    expect(result.missing).toContain('PR URL line');
    expect(result.missing).toContain('Linear issue URL line');
    expect(result.missing).toContain('subagents line');
  });

  it('detects invalid planning-agent final fields', () => {
    const invalidSuperpowers =
      CompletionVerifierTestUtils.verifyPlanningAgentFinal(`PLANNING_AGENT_FINAL:
- Outcome: planned
- superpowers_writing_plans_used: 0
- Original issue: https://linear.app/intexuraos/issue/INT-1
- Planning issue: https://linear.app/intexuraos/issue/INT-2
- Summary: mismatch`);
    expect(invalidSuperpowers.ok).toBe(false);
    if (invalidSuperpowers.ok) throw new Error('Expected invalid planning final');
    expect(invalidSuperpowers.missing).toContain('superpowers_writing_plans_used must be 1');

    const unclearMissingMessage =
      CompletionVerifierTestUtils.verifyPlanningAgentFinal(`PLANNING_AGENT_FINAL:
- Outcome: unclear
- superpowers_writing_plans_used: 1
- Original issue: https://linear.app/intexuraos/issue/INT-1
- Summary: need more info`);
    expect(unclearMissingMessage.ok).toBe(false);
    if (unclearMissingMessage.ok) throw new Error('Expected invalid unclear final');
    expect(unclearMissingMessage.missing).toContain('Clarification message line');
  });

  it('builds agent-specific default resume instructions', () => {
    const planningInstruction = CompletionVerifierTestUtils.buildDefaultResumeInstruction(
      'planning',
      ['missing-criteria']
    );
    const executionInstruction = CompletionVerifierTestUtils.buildDefaultResumeInstruction(
      'execution',
      ['missing-criteria']
    );

    expect(planningInstruction).toContain('PLANNING_AGENT_FINAL');
    expect(executionInstruction).toContain('EXECUTION_AGENT_FINAL');
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
      agentType: 'planning',
      originalPrompt: 'Prepare issue',
      rawLogs: assistantLog(validPhase1Final),
      linearIssueLabels: [],
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.usedLlm).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0]).toContain('PLANNING_AGENT_FINAL');
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        attempt: 1,
        agentType: 'planning',
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
      agentType: 'planning',
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
      agentType: 'planning',
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
      agentType: 'planning',
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
      agentType: 'planning',
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
          '{"passed":false,"confidence":0.88,"reasons":["phase contract mismatch"],"missingCriteria":["code-task requires Phase 2 ready: yes"],"resumeInstruction":"Fix PLANNING_AGENT_FINAL consistency."}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-phase1-mismatch',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'planning',
      originalPrompt: 'Analyze issue',
      rawLogs: assistantLog(`PLANNING_AGENT_FINAL:
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

  it('fails execution-agent when PR URL is missing from task result', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":false,"confidence":0.93,"reasons":["missing PR evidence"],"missingCriteria":["PR URL created from branch"],"resumeInstruction":"Create PR and provide EXECUTION_AGENT_FINAL evidence."}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });
    const verifier = createVerifier();

    const verdict = await verifier.verify({
      taskId: 'task-missing-pr',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
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

  it('still invokes Gemini when execution-agent contract checks fail deterministically', async () => {
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
      agentType: 'execution',
      originalPrompt: 'Implement and open PR',
      rawLogs: assistantLog(`EXECUTION_AGENT_FINAL:
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

  it('fails execution-agent when GitHub checks are failing', async () => {
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
      agentType: 'execution',
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

  it('fails execution-agent when CI status is unknown', async () => {
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
      agentType: 'execution',
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

  it('verifies execution using Claude responses only (ignores runtime signals) and extracts execution metadata', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content: JSON.stringify({
          passed: true,
          confidence: 0.94,
          reasons: ['all execution criteria met'],
          missingCriteria: [],
          resumeInstruction: '',
          extractedSummary: 'Implemented the task and completed the review loop.',
          executionMetadata: {
            outcomeLabel: 'implemented',
            superpowersExecutingPlansUsed: '1',
            superpowersRequestingCodeReviewUsed: '1',
            trivialTask: '0',
            subagents: 'impl (execution), reviewer (review loop)',
            reviewIterations: 2,
            linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-2',
          },
        }),
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-exec-llm-only',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
      originalPrompt: 'Implement task',
      rawLogs: assistantLog(validPhase2Final),
      linearIssueId: 'INT-2',
      linearIssueLabels: ['code-task'],
      workerExitCode: 99,
      claudeError: 'simulated runtime error',
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.executionMetadata).toEqual(
      expect.objectContaining({
        outcomeLabel: 'implemented',
        reviewIterations: 2,
        linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-2',
      })
    );
    expect(verdict.reasons.join(' ')).not.toContain('Worker exited with non-zero code');
    expect(generate.mock.calls[0]?.[0]).toContain('Claude responses only');
    expect(generate.mock.calls[0]?.[0]).not.toContain('Deterministic signals:');
  });

  it('hard-fails execution verification when execution final block issue URL mismatches routed issue', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content: JSON.stringify({
          passed: true,
          confidence: 0.95,
          reasons: ['all execution criteria met'],
          missingCriteria: [],
          resumeInstruction: '',
          extractedSummary: 'Completed work but referenced wrong issue URL.',
          executionMetadata: {
            outcomeLabel: 'implemented',
            superpowersExecutingPlansUsed: '1',
            superpowersRequestingCodeReviewUsed: '1',
            trivialTask: '1',
            subagents: 'none',
            reviewIterations: 1,
            linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-999',
          },
        }),
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-exec-wrong-issue',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
      originalPrompt: 'Implement task',
      rawLogs: assistantLog(validPhase2Final),
      linearIssueId: 'INT-2',
      linearIssueLabels: ['code-task'],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.missingCriteria.join(' ')).toContain('must match routed issue INT-2');
    expect(verdict.reasons.join(' ')).toContain('different Linear issue');
  });

  it('fails execution verification when metadata is missing and no assistant message exists', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content: JSON.stringify({
          passed: true,
          confidence: 0.9,
          reasons: ['looks good'],
          missingCriteria: [],
          resumeInstruction: '',
          extractedSummary: 'Completed task.',
        }),
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-exec-no-assistant',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
      originalPrompt: 'Implement task',
      rawLogs: '{"type":"result","is_error":false}',
      linearIssueId: 'INT-2',
      linearIssueLabels: ['code-task'],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.missingCriteria).toContain('execution metadata extraction');
  });

  it('treats non-linear metadata URL as wrong-issue mismatch', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content: JSON.stringify({
          passed: true,
          confidence: 0.95,
          reasons: ['all execution criteria met'],
          missingCriteria: [],
          resumeInstruction: '',
          extractedSummary: 'Completed work.',
          executionMetadata: {
            outcomeLabel: 'implemented',
            superpowersExecutingPlansUsed: '1',
            superpowersRequestingCodeReviewUsed: '1',
            trivialTask: '1',
            subagents: 'none',
            reviewIterations: 1,
            linearIssueUrl: 'https://example.com/not-linear',
          },
        }),
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-exec-non-linear-url',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
      originalPrompt: 'Implement task',
      rawLogs: assistantLog(validPhase2Final),
      linearIssueId: 'INT-2',
      linearIssueLabels: ['code-task'],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.missingCriteria.join(' ')).toContain('must match routed issue INT-2');
  });

  it('skips routed-issue mismatch enforcement when linearIssueId is absent', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content: JSON.stringify({
          passed: true,
          confidence: 0.95,
          reasons: ['all execution criteria met'],
          missingCriteria: [],
          resumeInstruction: '',
          extractedSummary: 'Completed work.',
          executionMetadata: {
            outcomeLabel: 'implemented',
            superpowersExecutingPlansUsed: '1',
            superpowersRequestingCodeReviewUsed: '1',
            trivialTask: '1',
            subagents: 'none',
            reviewIterations: 1,
            linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-2',
          },
        }),
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-exec-no-routed-issue',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
      originalPrompt: 'Implement task',
      rawLogs: assistantLog(validPhase2Final),
      linearIssueLabels: ['code-task'],
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.executionMetadata).toEqual(
      expect.objectContaining({
        outcomeLabel: 'implemented',
      })
    );
  });

  it('includes previous assistant responses as fallback evidence in execution verifier prompts', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content: JSON.stringify({
          passed: true,
          confidence: 0.95,
          reasons: ['ok'],
          missingCriteria: [],
          resumeInstruction: '',
          extractedSummary: 'Completed work.',
          executionMetadata: {
            outcomeLabel: 'implemented',
            superpowersExecutingPlansUsed: '1',
            superpowersRequestingCodeReviewUsed: '1',
            trivialTask: '1',
            subagents: 'none',
            reviewIterations: 1,
            linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-2',
          },
        }),
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const rawLogs = [assistantLog('Older execution response'), assistantLog(validPhase2Final)].join(
      '\n'
    );
    await verifier.verify({
      taskId: 'task-exec-previous-fallback',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
      originalPrompt: 'Implement task',
      rawLogs,
      linearIssueId: 'INT-2',
      linearIssueLabels: ['code-task'],
    });

    const llmPrompt = generate.mock.calls[0]?.[0];
    expect(llmPrompt).toContain('Previous Claude responses (FALLBACK ONLY):');
    expect(llmPrompt).toContain('Older execution response');
    expect(llmPrompt).not.toContain('Previous Claude responses (FALLBACK ONLY):\nnone');
  });

  it('fails execution verification when superpower proof values are explicit 0', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content: JSON.stringify({
          passed: false,
          confidence: 0.85,
          reasons: [
            'superpowers_executing_plans_used is 0',
            'superpowers_requesting_code_review_used is 0',
          ],
          missingCriteria: [
            'superpowers_executing_plans_used must be 1',
            'superpowers_requesting_code_review_used must be 1',
          ],
          resumeInstruction: 'Use both superpowers skills before completing.',
          extractedSummary: 'Task attempted but superpowers not used.',
          executionMetadata: {
            outcomeLabel: 'implemented',
            superpowersExecutingPlansUsed: '0',
            superpowersRequestingCodeReviewUsed: '0',
            trivialTask: '0',
            subagents: 'impl (code changes)',
            reviewIterations: 1,
            linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-2',
          },
        }),
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-exec-zero-superpowers',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
      originalPrompt: 'Implement task',
      rawLogs: assistantLog(validPhase2Final),
      linearIssueId: 'INT-2',
      linearIssueLabels: ['code-task'],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.missingCriteria.join(' ')).toContain('superpowers');
  });

  it('fails execution verification for non-trivial task with vague subagent text', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content: JSON.stringify({
          passed: false,
          confidence: 0.7,
          reasons: ['subagents field is vague — no explicit agent names or roles'],
          missingCriteria: ['subagents must list specific agent names and roles'],
          resumeInstruction: 'Specify which subagents were used and their roles.',
          extractedSummary: 'Task completed but subagent usage unclear.',
          executionMetadata: {
            outcomeLabel: 'implemented',
            superpowersExecutingPlansUsed: '1',
            superpowersRequestingCodeReviewUsed: '1',
            trivialTask: '0',
            subagents: 'used subagents',
            reviewIterations: 1,
            linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-2',
          },
        }),
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-exec-vague-subagents',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
      originalPrompt: 'Implement complex feature',
      rawLogs: assistantLog(validPhase2Final),
      linearIssueId: 'INT-2',
      linearIssueLabels: ['code-task'],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.missingCriteria.join(' ')).toContain('subagents');
    expect(verdict.resumeInstruction).toBeTruthy();
  });

  it('verifier receives both latest and prior responses when latest says only "done"', async () => {
    const priorResponse = validPhase2Final;
    const latestResponse = 'Done, task complete.';

    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content: JSON.stringify({
          passed: true,
          confidence: 0.92,
          reasons: ['found EXECUTION_AGENT_FINAL in prior response'],
          missingCriteria: [],
          resumeInstruction: '',
          extractedSummary: 'Completed task.',
          executionMetadata: {
            outcomeLabel: 'implemented',
            superpowersExecutingPlansUsed: '1',
            superpowersRequestingCodeReviewUsed: '1',
            trivialTask: '0',
            subagents: 'impl (code), reviewer (review)',
            reviewIterations: 2,
            linearIssueUrl: 'https://linear.app/intexuraos/issue/INT-2',
          },
        }),
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const rawLogs = [assistantLog(priorResponse), assistantLog(latestResponse)].join('\n');
    const verdict = await verifier.verify({
      taskId: 'task-exec-done-fallback',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
      originalPrompt: 'Implement task',
      rawLogs,
      linearIssueId: 'INT-2',
      linearIssueLabels: ['code-task'],
    });

    expect(verdict.passed).toBe(true);
    const llmPrompt = generate.mock.calls[0]?.[0];
    expect(llmPrompt).toContain('Previous Claude responses (FALLBACK ONLY):');
    expect(llmPrompt).toContain('EXECUTION_AGENT_FINAL');
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
      agentType: 'execution',
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
      agentType: 'planning',
      originalPrompt: 'Prepare issue',
      rawLogs: assistantLog(validPhase1Final),
      linearIssueLabels: [],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('Gemini verifier unavailable');
    expect(verdict.verifierFailure).toBe(true);
    expect(verdict.resumeInstruction).toContain('PLANNING_AGENT_FINAL');
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
      agentType: 'execution',
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
    expect(verdict.resumeInstruction).toContain('EXECUTION_AGENT_FINAL');
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
      agentType: 'planning',
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
      agentType: 'planning',
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
      agentType: 'planning',
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
      agentType: 'planning',
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
      agentType: 'planning',
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
      agentType: 'planning',
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
    expect(result.missing).toContain('PULL_REQUEST_AGENT_FINAL block');
  });

  it('validates valid PULL_REQUEST_AGENT_FINAL block', () => {
    const validPRCommentFinal = `PULL_REQUEST_AGENT_FINAL:
- PR: https://github.com/intexuraos/intexuraos/pull/42
- CI evidence: pnpm run ci:tracked successful
- Linear issue: https://linear.app/intexuraos/issue/INT-100
- Comment replied: yes
- Summary: Investigated PR comment requesting auth fix. Implemented changes to middleware. CI passes. Pushed to existing branch and replied to commenter.`;

    const result = CompletionVerifierTestUtils.verifyPRCommentFinal(validPRCommentFinal);
    expect(result.ok).toBe(true);
  });

  it('detects missing Comment replied line in PULL_REQUEST_AGENT_FINAL', () => {
    const missingCommentReply = `PULL_REQUEST_AGENT_FINAL:
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
    const instruction = CompletionVerifierTestUtils.buildDefaultResumeInstruction('pull_request', [
      'missing-criteria',
    ]);

    expect(instruction).toContain('PULL_REQUEST_AGENT_FINAL');
    expect(instruction).toContain('Push changes');
    expect(instruction).toContain('reply to the comment');
  });

  it('fails pr-comment when PULL_REQUEST_AGENT_FINAL block is missing from assistant message', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        content:
          '{"passed":false,"confidence":0.85,"reasons":["missing PULL_REQUEST_AGENT_FINAL"],"missingCriteria":["PULL_REQUEST_AGENT_FINAL block"],"resumeInstruction":"Add PULL_REQUEST_AGENT_FINAL block."}',
      },
    });
    createLlmClientMock.mockReturnValue({ generate });

    const verifier = createVerifier();
    const verdict = await verifier.verify({
      taskId: 'task-pr-comment-missing-block',
      attempt: 1,
      maxAttempts: 3,
      agentType: 'pull_request',
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
    expect(verdict.missingCriteria).toContain('PULL_REQUEST_AGENT_FINAL block');
    expect(verdict.reasons.join(' ')).toContain(
      'Pull Request Agent completion contract was not met'
    );
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

    const validPRCommentFinal = `PULL_REQUEST_AGENT_FINAL:
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
      agentType: 'pull_request',
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
    expect(generate.mock.calls[0]?.[0]).toContain('PULL_REQUEST_AGENT_FINAL');
    expect(generate.mock.calls[0]?.[0]).not.toContain('EXECUTION_AGENT_FINAL');
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

    const validPRCommentFinal = `PULL_REQUEST_AGENT_FINAL:
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
      agentType: 'pull_request',
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

    const validPRCommentFinal = `PULL_REQUEST_AGENT_FINAL:
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
      agentType: 'pull_request',
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
    expect(verdict.resumeInstruction).toContain('PULL_REQUEST_AGENT_FINAL');
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

    const validPRCommentFinal = `PULL_REQUEST_AGENT_FINAL:
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
      agentType: 'pull_request',
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
      agentType: 'planning',
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
