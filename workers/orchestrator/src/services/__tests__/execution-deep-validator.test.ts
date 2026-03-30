import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { readFile } from 'node:fs/promises';

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
const postedCommentBodies: string[] = [];

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
    outcome: 'implemented' as const,
    superpowers_executing_plans: 'used' as const,
    superpowers_requesting_code_review: 'used' as const,
    gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1071',
    summary: 'Implemented the fix.',
  },
  linearIssueBody: 'Fix the PWA header',
  planContent: undefined,
  workerType: 'auto',
};

const markdownResponse = [
  '#### Overall',
  '| Result | Evidence |',
  '| --- | --- |',
  '| 🟢 Pass | Validation completed against the transcript at MSG-001. |',
  '',
  '#### Claim Verification',
  '| Claim | Result | Evidence |',
  '| --- | --- | --- |',
  '| CI ran | 🟢 Pass | MSG-001 shows pnpm run ci:tracked. |',
  '',
  '#### Contract Verification',
  '| Obligation | Result | Evidence |',
  '| --- | --- | --- |',
  '| Code review subagent | 🟢 Pass | MSG-010 shows a code-reviewer subagent dispatch. |',
  '',
  '#### Plan vs Reality',
  '| Requirement | Result | Evidence |',
  '| --- | --- | --- |',
  '| Header fix | 🟢 Pass | MSG-020 and MSG-021 show edits and tests. |',
  '',
  '#### Anomalies',
  '| Type | Severity | Evidence | Detail |',
  '| --- | --- | --- | --- |',
  '| None | 🟢 Pass | None | None |',
].join('\n');

const verboseMarkdownResponse = [
  '#### Overall',
  '| Result | Evidence |',
  '| --- | --- |',
  `| 🟢 Pass | ${'overall '.repeat(6000)} |`,
  '',
  '#### Claim Verification',
  '| Claim | Result | Evidence |',
  '| --- | --- | --- |',
  `| CI ran | 🟢 Pass | ${'claim '.repeat(6000)} |`,
  '',
  '#### Contract Verification',
  '| Obligation | Result | Evidence |',
  '| --- | --- | --- |',
  `| Code review subagent | 🟢 Pass | ${'contract '.repeat(6000)} |`,
  '',
  '#### Plan vs Reality',
  '| Requirement | Result | Evidence |',
  '| --- | --- | --- |',
  `| Header fix | 🟢 Pass | ${'plan '.repeat(6000)} |`,
  '',
  '#### Anomalies',
  '| Type | Severity | Evidence | Detail |',
  '| --- | --- | --- | --- |',
  `| Retry loop | 🟠 Warning | MSG-999 | ${'anomaly '.repeat(6000)} |`,
].join('\n');

function buildValidReport(overrides?: {
  overall?: string[];
  claimVerification?: string[];
  contractVerification?: string[];
  planVsReality?: string[];
  anomalies?: string[];
}): string {
  return [
    '#### Overall',
    ...(overrides?.overall ?? ['| Result | Evidence |', '| --- | --- |', '| Passed | MSG-001 |']),
    '',
    '#### Claim Verification',
    ...(overrides?.claimVerification ?? [
      '| Claim | Result | Evidence |',
      '| --- | --- | --- |',
      '| CI ran | Verified | MSG-001 |',
    ]),
    '',
    '#### Contract Verification',
    ...(overrides?.contractVerification ?? [
      '| Obligation | Result | Evidence |',
      '| --- | --- | --- |',
      '| Code review subagent | Verified | MSG-010 |',
    ]),
    '',
    '#### Plan vs Reality',
    ...(overrides?.planVsReality ?? [
      '| Requirement | Result | Evidence |',
      '| --- | --- | --- |',
      '| Header fix | Implemented | MSG-020 |',
    ]),
    '',
    '#### Anomalies',
    ...(overrides?.anomalies ?? [
      '| Type | Severity | Evidence | Detail |',
      '| --- | --- | --- | --- |',
      '| None | None | None | None |',
    ]),
  ].join('\n');
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  postedCommentBodies.length = 0;
  createLlmClientMock.mockReturnValue({ generate: generateMock });
  execFileMock.mockImplementation(
    (
      _cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, result: { stdout: string }) => void
    ) => {
      const bodyFileIndex = args.indexOf('--body-file');
      if (bodyFileIndex === -1) {
        cb(null, { stdout: '' });
        return;
      }

      const bodyFilePath = args[bodyFileIndex + 1];
      void readFile(String(bodyFilePath), 'utf8')
        .then((body) => {
          postedCommentBodies.push(body);
          cb(null, { stdout: '' });
        })
        .catch((error: unknown) => {
          cb(error as Error, { stdout: '' });
        });
    }
  );
});

describe('buildDeepValidationPrompt', () => {
  it('includes prompt version header and markdown contract', () => {
    const prompt = buildDeepValidationPrompt({
      formattedTranscript: 'test',
      agentClaims: {
        outcome: 'implemented',
        superpowers_executing_plans: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: '',
        summary: 'Done.',
      },
      linearIssueBody: 'task',
      planContent: undefined,
      workerType: 'auto',
    });

    expect(prompt).toContain(`[deep-validation-prompt v${DEEP_VALIDATION_PROMPT_VERSION}]`);
    expect(prompt).toContain('Return ONLY markdown.');
    expect(prompt).toContain('Return the report explicitly as markdown tables.');
    expect(prompt).toContain('Do not return bullet lists, numbered lists, JSON, or code fences.');
    expect(prompt).toContain('Do not return a list anywhere in the response.');
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
        outcome: 'implemented',
        superpowers_executing_plans: 'not used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1071',
        summary: 'Implemented the fix.',
      },
      linearIssueBody: 'Fix the PWA header logo shift',
      planContent: '## Plan\n1. Update tests first',
      workerType: 'auto',
    });

    expect(prompt).toContain('Section 1: Claim Verification');
    expect(prompt).toContain('Section 2: Contract Verification');
    expect(prompt).toContain('Section 3: Plan vs Reality');
    expect(prompt).toContain('"superpowers_executing_plans": "not used"');
    expect(prompt).toContain('Fix the PWA header logo shift');
    expect(prompt).toContain('Update tests first');
  });

  it('asks the validator to check Codex bootstrap evidence lines for codex workers', () => {
    const prompt = buildDeepValidationPrompt({
      formattedTranscript: 'No evidence lines in this transcript',
      agentClaims: {
        outcome: 'implemented',
        superpowers_executing_plans: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: '',
        summary: 'Done.',
      },
      linearIssueBody: 'Some task',
      planContent: undefined,
      workerType: 'codex',
    });

    expect(prompt).toContain('startup evidence lines');
    expect(prompt).toContain('`[entrypoint] Bootstrap evidence:`');
    expect(prompt).toContain('`[entrypoint] Codex runtime evidence:`');
  });

  it('includes Codex bootstrap evidence lines for codex-xhigh workers', () => {
    const prompt = buildDeepValidationPrompt({
      formattedTranscript: 'transcript',
      agentClaims: {
        outcome: 'implemented',
        superpowers_executing_plans: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: '',
        summary: 'Done.',
      },
      linearIssueBody: 'Some task',
      planContent: undefined,
      workerType: 'codex-xhigh',
    });

    expect(prompt).toContain('`[entrypoint] Bootstrap evidence:`');
    expect(prompt).toContain('`[entrypoint] Codex runtime evidence:`');
  });

  it('omits Codex bootstrap evidence lines for non-codex workers', () => {
    for (const workerType of ['auto', 'opus', 'sonnet', 'minimax', 'glm', 'qwen', 'kimi']) {
      const prompt = buildDeepValidationPrompt({
        formattedTranscript: 'transcript',
        agentClaims: {
          outcome: 'implemented',
          superpowers_executing_plans: 'used',
          superpowers_requesting_code_review: 'used',
          gh_pr_url: '',
          summary: 'Done.',
        },
        linearIssueBody: 'Some task',
        planContent: undefined,
        workerType,
      });

      expect(prompt).not.toContain('`[entrypoint] Bootstrap evidence:`');
      expect(prompt).not.toContain('`[entrypoint] Codex runtime evidence:`');
      expect(prompt).not.toContain('startup evidence lines');
    }
  });

  it('indicates when no referenced plan document was found', () => {
    const prompt = buildDeepValidationPrompt({
      formattedTranscript: 'transcript here',
      agentClaims: {
        outcome: 'implemented',
        superpowers_executing_plans: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: '',
        summary: 'Done.',
      },
      linearIssueBody: 'Some task',
      planContent: undefined,
      workerType: 'auto',
    });

    expect(prompt).toContain('No plan document referenced in Linear issue');
  });

  it('includes severity scale definitions in prompt', () => {
    const prompt = buildDeepValidationPrompt({
      formattedTranscript: 'test',
      agentClaims: {
        outcome: 'implemented',
        superpowers_executing_plans: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: '',
        summary: 'Done.',
      },
      linearIssueBody: 'task',
      planContent: undefined,
      workerType: 'auto',
    });

    expect(prompt).toContain('=== Severity Scale ===');
    expect(prompt).toContain('🔴 Critical');
    expect(prompt).toContain('🟠 Warning');
    expect(prompt).toContain('🟡 Minor');
    expect(prompt).toContain('🟢 Pass');
    expect(prompt).toContain('Use ONLY these severity levels');
  });

  it('truncates transcript exceeding MAX_TRANSCRIPT_CHARS', () => {
    const longTranscript = 'A'.repeat(250_000);
    const prompt = buildDeepValidationPrompt({
      formattedTranscript: longTranscript,
      agentClaims: {
        outcome: 'implemented',
        superpowers_executing_plans: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: '',
        summary: 'Done.',
      },
      linearIssueBody: 'task',
      planContent: undefined,
      workerType: 'auto',
    });

    expect(prompt).toContain('[TRANSCRIPT TRUNCATED at 200000 chars');
    expect(prompt).toContain('250000 total]');
    expect(prompt.length).toBeLessThan(longTranscript.length);
  });
});

function expectProgressRejection(onProgress: ReturnType<typeof vi.fn>, reason: string): void {
  expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('response rejected: '));
  expect(onProgress).toHaveBeenCalledWith(expect.stringContaining(reason));
}

describe('OrchestratorExecutionDeepValidator', () => {
  it('posts markdown comment via body-file and returns true on valid LLM response', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: { content: markdownResponse, usage: { costUsd: 0.05 } },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);

    expect(result).toBe(true);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock.mock.calls[0]?.[0]).toBe('gh');
    expect(execFileMock.mock.calls[0]?.[1]).toEqual([
      'pr',
      'comment',
      '1071',
      '--repo',
      'pbuchman/intexuraos',
      '--body-file',
      expect.any(String),
    ]);

    const bodyArg = postedCommentBodies[0] ?? '';
    expect(bodyArg).toContain(
      '### Deep Validation Report — IntexuraOS Agent-Based Code Task Execution Flow'
    );
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
    const bodyArg = postedCommentBodies[0] ?? '';
    expect(bodyArg).toContain(markdownResponse);
    expect(bodyArg).not.toContain('```');
  });

  it('allows leading blank lines before the first heading', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: {
        content: `\n\n${markdownResponse}`,
        usage: { costUsd: 0.042 },
      },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);

    expect(result).toBe(true);
    expect(postedCommentBodies[0]).toContain(
      '### Deep Validation Report — IntexuraOS Agent-Based Code Task Execution Flow'
    );
    expect(postedCommentBodies[0]).toContain(markdownResponse);
  });

  it('rejects list output instead of posting it', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: {
        content: ['#### Overall', '- this is a list', '', '#### Claim Verification'].join('\n'),
        usage: { costUsd: 0.042 },
      },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);

    expect(result).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task_abc',
        reason: expect.stringContaining('bullet lists'),
      }),
      'Deep validation response rejected'
    );
    expectProgressRejection(onProgress, 'bullet lists');
  });

  it('rejects reports with a preamble before the first heading', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: {
        content: `Intro paragraph\n\n${buildValidReport()}`,
        usage: { costUsd: 0.042 },
      },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);

    expect(result).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: expect.stringContaining('no preamble') }),
      'Deep validation response rejected'
    );
    expectProgressRejection(onProgress, 'no preamble');
  });

  it('rejects reports with required headings out of order', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: {
        content: [
          '#### Overall',
          '| Result | Evidence |',
          '| --- | --- |',
          '| Passed | MSG-001 |',
          '',
          '#### Contract Verification',
          '| Obligation | Result | Evidence |',
          '| --- | --- | --- |',
          '| Code review subagent | Verified | MSG-010 |',
          '',
          '#### Claim Verification',
          '| Claim | Result | Evidence |',
          '| --- | --- | --- |',
          '| CI ran | Verified | MSG-001 |',
          '',
          '#### Plan vs Reality',
          '| Requirement | Result | Evidence |',
          '| --- | --- | --- |',
          '| Header fix | Implemented | MSG-020 |',
          '',
          '#### Anomalies',
          '| Type | Severity | Evidence | Detail |',
          '| --- | --- | --- | --- |',
          '| None | None | None | None |',
        ].join('\n'),
        usage: { costUsd: 0.042 },
      },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);

    expect(result).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: expect.stringContaining('out of order') }),
      'Deep validation response rejected'
    );
    expectProgressRejection(onProgress, 'out of order');
  });

  it('rejects reports missing required sections', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: {
        content: [
          '#### Overall',
          '| Result | Evidence |',
          '| --- | --- |',
          '| Passed | MSG-001 |',
        ].join('\n'),
        usage: { costUsd: 0.042 },
      },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);

    expect(result).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: expect.stringContaining('out of order') }),
      'Deep validation response rejected'
    );
    expectProgressRejection(onProgress, 'out of order');
  });

  it('rejects sections without a table data row', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: {
        content: buildValidReport({
          overall: ['| Result | Evidence |', '| --- | --- |'],
        }),
        usage: { costUsd: 0.042 },
      },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);

    expect(result).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: expect.stringContaining('at least one data row') }),
      'Deep validation response rejected'
    );
    expectProgressRejection(onProgress, 'at least one data row');
  });

  it('rejects sections that include prose lines outside the table', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: {
        content: buildValidReport({
          overall: [
            'Summary text',
            '| Result | Evidence |',
            '| --- | --- |',
            '| Passed | MSG-001 |',
          ],
        }),
        usage: { costUsd: 0.042 },
      },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);

    expect(result).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: expect.stringContaining('no list or prose lines') }),
      'Deep validation response rejected'
    );
    expectProgressRejection(onProgress, 'no list or prose lines');
  });

  it('rejects sections with an invalid markdown table separator row', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: {
        content: buildValidReport({
          overall: ['| Result | Evidence |', '| not-a-separator | nope |', '| Passed | MSG-001 |'],
        }),
        usage: { costUsd: 0.042 },
      },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);

    expect(result).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: expect.stringContaining('header separator row') }),
      'Deep validation response rejected'
    );
    expectProgressRejection(onProgress, 'header separator row');
  });

  it('splits long valid responses into multiple comments without breaking tables', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: { content: verboseMarkdownResponse, usage: { costUsd: 0.042 } },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);

    expect(result).toBe(true);
    expect(execFileMock.mock.calls.length).toBeGreaterThan(1);

    const postedBodies = [...postedCommentBodies];

    expect(postedBodies[0]).toContain('### Deep Validation Report (Part 1/');
    expect(postedBodies[0]).toContain('**Cost:** $0.042');
    expect(postedBodies[1]).not.toContain('**Cost:**');
    for (const body of postedBodies) {
      expect(body.length).toBeLessThan(65_536);
      expect(body).not.toContain('[truncated by orchestrator]');
      expect(body.match(/^#### /gmu)?.length ?? 0).toBe(1);
    }
  });

  it('fails when a single table section exceeds the GitHub comment limit', async () => {
    const oversizedSection = [
      '#### Overall',
      '| Result | Evidence |',
      '| --- | --- |',
      `| Passed | ${'too-long '.repeat(9000)} |`,
      '',
      '#### Claim Verification',
      '| Claim | Result | Evidence |',
      '| --- | --- | --- |',
      '| CI ran | Verified | MSG-001 |',
      '',
      '#### Contract Verification',
      '| Obligation | Result | Evidence |',
      '| --- | --- | --- |',
      '| Code review subagent | Verified | MSG-010 |',
      '',
      '#### Plan vs Reality',
      '| Requirement | Result | Evidence |',
      '| --- | --- | --- |',
      '| Header fix | Implemented | MSG-020 |',
      '',
      '#### Anomalies',
      '| Type | Severity | Evidence | Detail |',
      '| --- | --- | --- | --- |',
      '| None | None | None | None |',
    ].join('\n');

    generateMock.mockResolvedValue({
      ok: true,
      value: { content: oversizedSection, usage: { costUsd: 0.042 } },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);

    expect(result).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task_abc',
        reason: expect.stringContaining('single section'),
      }),
      'Deep validation response rejected'
    );
    expectProgressRejection(onProgress, 'single section');
  });

  it('fails when a later single section still exceeds the limit after splitting starts', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: {
        content: buildValidReport({
          claimVerification: [
            '| Claim | Result | Evidence |',
            '| --- | --- | --- |',
            `| CI ran | Verified | ${'huge '.repeat(14000)} |`,
          ],
        }),
        usage: { costUsd: 0.042 },
      },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);

    expect(result).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: expect.stringContaining('single section') }),
      'Deep validation response rejected'
    );
    expectProgressRejection(onProgress, 'single section');
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

  it('logs stderr when PR comment posting fails with execFile-style error', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: { content: markdownResponse, usage: { costUsd: 0.042 } },
    });
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        const error = new Error('gh failed') as Error & { stderr: string };
        error.stderr = 'fatal: authentication required';
        cb(error);
      }
    );

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);

    expect(result).toBe(false);
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task_abc',
        error: 'gh failed',
        stderr: 'fatal: authentication required',
      }),
      'Failed to post deep validation PR comment'
    );
  });

  it('logs undefined stderr when PR comment posting fails with plain Error', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: { content: markdownResponse, usage: { costUsd: 0.042 } },
    });
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error('plain error'));
      }
    );

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);

    expect(result).toBe(false);
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task_abc',
        error: 'plain error',
        stderr: undefined,
      }),
      'Failed to post deep validation PR comment'
    );
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
