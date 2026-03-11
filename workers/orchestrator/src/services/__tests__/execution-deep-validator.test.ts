import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';

const { createLlmClientMock, execFileMock } = vi.hoisted(() => ({
  createLlmClientMock: vi.fn(),
  execFileMock: vi.fn(),
}));

vi.mock('@intexuraos/llm-factory', () => ({
  createLlmClient: createLlmClientMock,
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

const {
  buildDeepValidationPrompt,
  DEEP_VALIDATION_PROMPT_VERSION,
  OrchestratorExecutionDeepValidator,
} = await import('../execution-deep-validator.js');

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

const generateMock = vi.fn();

const defaultConfig = {
  model: 'gemini-2.5-flash' as const,
  geminiApiKey: 'test-key',
  auditLogPath: '/tmp/deep-validator-audit.test.log',
};

const defaultInput = {
  taskId: 'task_abc',
  prNumber: 1071,
  repository: 'pbuchman/intexuraos',
  formattedTranscript: '[MSG-001] ASSISTANT tool_use: Bash\n  command: "pnpm run ci:tracked"',
  agentClaims: {
    superpowers_executing_plans: 'used' as const,
    superpowers_requesting_code_review: 'used' as const,
    gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1071',
    summary: 'Implemented the fix.',
  },
  linearIssueBody: 'Fix the PWA header',
  planContent: undefined,
};

const markdownResponse = [
  '#### Overall',
  '- Validation completed against the transcript.',
  '',
  '#### Claim Verification',
  '- CI evidence is present at MSG-001.',
  '',
  '#### Contract Verification',
  '- Code review subagent usage is visible in the transcript.',
  '',
  '#### Plan vs Reality',
  '- Requirements were implemented with matching edits and tests.',
  '',
  '#### Anomalies',
  '- None.',
].join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  createLlmClientMock.mockReturnValue({ generate: generateMock });
  execFileMock.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: null, result: { stdout: string }) => void
    ) => {
      cb(null, { stdout: '' });
    }
  );
});

describe('buildDeepValidationPrompt', () => {
  it('includes prompt version header and markdown contract', () => {
    const prompt = buildDeepValidationPrompt({
      formattedTranscript: 'test',
      agentClaims: {
        superpowers_executing_plans: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: '',
        summary: 'Done.',
      },
      linearIssueBody: 'task',
      planContent: undefined,
    });

    expect(prompt).toContain(`[deep-validation-prompt v${DEEP_VALIDATION_PROMPT_VERSION}]`);
    expect(prompt).toContain('Return ONLY markdown.');
    expect(prompt).toContain('Do not return JSON, tables, or code fences.');
    expect(prompt).toContain('Keep the entire response under 4000 characters.');
    expect(prompt).toContain('#### Overall');
    expect(prompt).toContain('#### Claim Verification');
    expect(prompt).toContain('#### Contract Verification');
    expect(prompt).toContain('#### Plan vs Reality');
    expect(prompt).toContain('#### Anomalies');
  });

  it('includes all validation sections and agent claims', () => {
    const prompt = buildDeepValidationPrompt({
      formattedTranscript: '[MSG-001] ASSISTANT tool_use: Bash\n  command: "pnpm run ci:tracked"',
      agentClaims: {
        superpowers_executing_plans: 'not used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1071',
        summary: 'Implemented the fix.',
      },
      linearIssueBody: 'Fix the PWA header logo shift',
      planContent: '## Plan\n1. Update tests first',
    });

    expect(prompt).toContain('Section 1: Claim Verification');
    expect(prompt).toContain('Section 2: Contract Verification');
    expect(prompt).toContain('Section 3: Plan vs Reality');
    expect(prompt).toContain('"superpowers_executing_plans": "not used"');
    expect(prompt).toContain('Fix the PWA header logo shift');
    expect(prompt).toContain('Update tests first');
  });

  it('indicates when no plan file was found', () => {
    const prompt = buildDeepValidationPrompt({
      formattedTranscript: 'transcript here',
      agentClaims: {
        superpowers_executing_plans: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: '',
        summary: 'Done.',
      },
      linearIssueBody: 'Some task',
      planContent: undefined,
    });

    expect(prompt).toContain('No plan file found on branch.');
  });

  it('truncates transcript exceeding MAX_TRANSCRIPT_CHARS', () => {
    const longTranscript = 'A'.repeat(250_000);
    const prompt = buildDeepValidationPrompt({
      formattedTranscript: longTranscript,
      agentClaims: {
        superpowers_executing_plans: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: '',
        summary: 'Done.',
      },
      linearIssueBody: 'task',
      planContent: undefined,
    });

    expect(prompt).toContain('[TRANSCRIPT TRUNCATED at 200000 chars');
    expect(prompt).toContain('250000 total]');
    expect(prompt.length).toBeLessThan(longTranscript.length);
  });
});

describe('OrchestratorExecutionDeepValidator', () => {
  it('posts markdown comment and returns true on valid LLM response', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: { content: markdownResponse, usage: { costUsd: 0.05 } },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);

    expect(result).toBe(true);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith(
      'gh',
      ['pr', 'comment', '1071', '--repo', 'pbuchman/intexuraos', '--body', expect.any(String)],
      {},
      expect.any(Function)
    );

    const bodyArg = String(execFileMock.mock.calls[0]?.[1]?.[6] ?? '');
    expect(bodyArg).toContain('### Deep Validation Report');
    expect(bodyArg).toContain('**Cost:** $0.05');
    expect(bodyArg).toContain(markdownResponse);

    const progressCalls = onProgress.mock.calls.map((call) => String(call[0]));
    expect(progressCalls).toContain('calling Gemini for analysis...');
    expect(progressCalls).toContain('validation response received');
    expect(progressCalls).toContain('posting PR comment...');
    expect(progressCalls).toContain('PR comment posted');
  });

  it('returns false when LLM call fails', async () => {
    generateMock.mockResolvedValue({
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'down' },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);

    expect(result).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'SERVICE_UNAVAILABLE', errorMessage: 'down' }),
      'Deep validation LLM call failed'
    );

    const progressCalls = onProgress.mock.calls.map((call) => String(call[0]));
    expect(progressCalls).toContain('calling Gemini for analysis...');
    expect(progressCalls[1]).toContain('LLM call failed');
  });

  it('returns false when response is empty after sanitization', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: { content: '```markdown\n   \n```', usage: { costUsd: 0.042 } },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);

    expect(result).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_abc' }),
      'Deep validation response empty after sanitization'
    );

    const progressCalls = onProgress.mock.calls.map((call) => String(call[0]));
    expect(progressCalls).toContain('validation response received');
    expect(progressCalls).toContain('response empty after sanitization, skipping PR comment');
  });

  it('strips surrounding code fences before posting', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: {
        content: `\`\`\`markdown\n${markdownResponse}\n\`\`\``,
        usage: { costUsd: 0.042 },
      },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);

    expect(result).toBe(true);
    const bodyArg = String(execFileMock.mock.calls[0]?.[1]?.[6] ?? '');
    expect(bodyArg).toContain(markdownResponse);
    expect(bodyArg).not.toContain('```');
  });

  it('truncates long responses before posting', async () => {
    const longBody = `#### Overall\n- ${'A'.repeat(5000)}`;
    generateMock.mockResolvedValue({
      ok: true,
      value: { content: longBody, usage: { costUsd: 0.042 } },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);

    expect(result).toBe(true);
    const bodyArg = String(execFileMock.mock.calls[0]?.[1]?.[6] ?? '');
    expect(bodyArg).toContain('[truncated by orchestrator]');
    expect(bodyArg).toContain('### Deep Validation Report');
  });

  it('returns false when PR comment posting fails', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: { content: markdownResponse, usage: { costUsd: 0.042 } },
    });
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error('gh CLI not found'));
      }
    );

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);

    expect(result).toBe(false);
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_abc' }),
      'Failed to post deep validation PR comment'
    );

    const progressCalls = onProgress.mock.calls.map((call) => String(call[0]));
    expect(progressCalls).toContain('PR comment failed (see server logs)');
  });

  it('works without onProgress callback', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: { content: markdownResponse, usage: { costUsd: 0.042 } },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);

    expect(result).toBe(true);
  });

  it('throws on wrong model', () => {
    expect(
      () =>
        new OrchestratorExecutionDeepValidator(logger, {
          ...defaultConfig,
          model: 'gpt-4o' as unknown as 'gemini-2.5-flash',
        })
    ).toThrow('Deep validator must use model gemini-2.5-flash');
  });

  it('throws on empty geminiApiKey', () => {
    expect(
      () =>
        new OrchestratorExecutionDeepValidator(logger, {
          ...defaultConfig,
          geminiApiKey: '',
        })
    ).toThrow('INTEXURAOS_GEMINI_APP_API_KEY is required for deep validator');
  });

  it('throws on empty auditLogPath', () => {
    expect(
      () =>
        new OrchestratorExecutionDeepValidator(logger, {
          ...defaultConfig,
          auditLogPath: '',
        })
    ).toThrow('Deep validator auditLogPath is required');
  });
});
