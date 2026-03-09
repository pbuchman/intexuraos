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
  DEEP_VALIDATION_SCHEMA,
  DEEP_VALIDATION_PROMPT_VERSION,
  OrchestratorExecutionDeepValidator,
  formatPrComment,
} = await import('../execution-deep-validator.js');

describe('buildDeepValidationPrompt', () => {
  it('includes prompt version header', () => {
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
  });

  it('includes all three validation sections', () => {
    const prompt = buildDeepValidationPrompt({
      formattedTranscript: '[MSG-001] ASSISTANT tool_use: Bash\n  command: "pnpm run ci:tracked"',
      agentClaims: {
        superpowers_executing_plans: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1071',
        summary: 'Implemented the fix.',
      },
      linearIssueBody: 'Fix the PWA header logo shift',
      planContent: '## Plan\n1. Move workers status to menu',
    });

    expect(prompt).toContain('Section 1: Claim Verification');
    expect(prompt).toContain('Section 2: Contract Verification');
    expect(prompt).toContain('Section 3: Plan vs Reality');
    expect(prompt).toContain('pnpm run ci:tracked');
    expect(prompt).toContain('superpowers_requesting_code_review');
    expect(prompt).toContain('Fix the PWA header logo shift');
    expect(prompt).toContain('Move workers status to menu');
  });

  it('indicates when no plan file was found', () => {
    const prompt = buildDeepValidationPrompt({
      formattedTranscript: '[MSG-001] ASSISTANT text:\n  Hello',
      agentClaims: {
        superpowers_executing_plans: 'used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: '',
        summary: 'Done.',
      },
      linearIssueBody: 'Some task',
      planContent: undefined,
    });

    expect(prompt).toContain('No plan file found on branch');
  });

  it('includes agent claims verbatim for verification', () => {
    const prompt = buildDeepValidationPrompt({
      formattedTranscript: 'transcript here',
      agentClaims: {
        superpowers_executing_plans: 'not used',
        superpowers_requesting_code_review: 'used',
        gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/99',
        summary: 'Fixed the bug.',
      },
      linearIssueBody: 'Fix bug',
      planContent: undefined,
    });

    expect(prompt).toContain('"superpowers_executing_plans": "not used"');
    expect(prompt).toContain('"superpowers_requesting_code_review": "used"');
  });
});

describe('DEEP_VALIDATION_SCHEMA', () => {
  it('accepts a valid deep validation response', () => {
    const result = DEEP_VALIDATION_SCHEMA.safeParse({
      claimVerification: [
        {
          claim: 'CI passed',
          verdict: 'verified',
          evidence: 'MSG-128: ci:tracked exit 0',
        },
      ],
      contractVerification: [
        {
          obligation: 'executing-plans invoked first',
          verdict: 'fulfilled',
          evidence: 'MSG-012: Skill(superpowers:executing-plans)',
        },
      ],
      planVsReality: {
        planFound: true,
        requirements: [
          {
            requirement: 'Move workers status',
            verdict: 'implemented',
            evidence: 'MSG-078: Edit(Header.tsx)',
          },
        ],
      },
      anomalies: [
        {
          type: 'fabrication',
          severity: 'critical',
          evidence: 'MSG-048: TaskOutput errored',
          detail: 'Agent claimed review passed from clean working tree',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts response with empty anomalies', () => {
    const result = DEEP_VALIDATION_SCHEMA.safeParse({
      claimVerification: [],
      contractVerification: [],
      planVsReality: {
        planFound: false,
        requirements: [],
      },
      anomalies: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects anomaly with invalid type value', () => {
    const result = DEEP_VALIDATION_SCHEMA.safeParse({
      claimVerification: [],
      contractVerification: [],
      planVsReality: { planFound: false, requirements: [] },
      anomalies: [
        {
          type: 'unknown_type',
          severity: 'info',
          evidence: 'MSG-001',
          detail: 'some detail',
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

// --- Task 7 tests: validate() method and formatPrComment ---

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

beforeEach(() => {
  vi.clearAllMocks();
  createLlmClientMock.mockReturnValue({ generate: generateMock });
  // execFile uses callback pattern — promisify expects (err, result) callback as last arg
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
  worktreePath: '/tmp/worktree',
};

describe('OrchestratorExecutionDeepValidator', () => {
  it('returns parsed result on valid LLM response', async () => {
    const validResponse = JSON.stringify({
      claimVerification: [{ claim: 'CI passed', verdict: 'verified', evidence: 'MSG-001' }],
      contractVerification: [],
      planVsReality: { planFound: false, requirements: [] },
      anomalies: [],
    });
    generateMock.mockResolvedValue({ ok: true, value: { content: validResponse, usage: {} } });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);

    expect(result).toBeDefined();
    expect(result?.claimVerification).toHaveLength(1);
    expect(result?.claimVerification[0]?.verdict).toBe('verified');
    expect(execFileMock).toHaveBeenCalledWith(
      'gh',
      [
        'pr',
        'comment',
        '1071',
        '--repo',
        'pbuchman/intexuraos',
        '--body',
        expect.stringContaining('Deep Validation Report'),
      ],
      { cwd: '/tmp/worktree' },
      expect.any(Function)
    );
  });

  it('returns undefined when LLM call fails', async () => {
    generateMock.mockResolvedValue({
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'down' },
    });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);

    expect(result).toBeUndefined();
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'SERVICE_UNAVAILABLE', errorMessage: 'down' }),
      expect.any(String)
    );
  });

  it('returns undefined when LLM returns non-JSON', async () => {
    generateMock.mockResolvedValue({ ok: true, value: { content: 'Not JSON at all', usage: {} } });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);

    expect(result).toBeUndefined();
  });

  it('posts raw comment when Zod validation fails', async () => {
    // Valid JSON but wrong schema
    const invalidSchema = JSON.stringify({ unexpected: 'data' });
    generateMock.mockResolvedValue({ ok: true, value: { content: invalidSchema, usage: {} } });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);

    expect(result).toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_abc' }),
      expect.stringContaining('Zod validation failed')
    );
  });

  it('extracts JSON embedded in markdown fences', async () => {
    const embeddedJson = `Here is the result:\n${JSON.stringify({
      claimVerification: [],
      contractVerification: [],
      planVsReality: { planFound: false, requirements: [] },
      anomalies: [],
    })}\nEnd.`;
    generateMock.mockResolvedValue({ ok: true, value: { content: embeddedJson, usage: {} } });

    const validator = new OrchestratorExecutionDeepValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);

    expect(result).toBeDefined();
    expect(result?.claimVerification).toHaveLength(0);
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

describe('formatPrComment', () => {
  it('formats all sections into markdown', () => {
    const result = {
      claimVerification: [
        { claim: 'CI passed', verdict: 'verified' as const, evidence: 'MSG-128: exit 0' },
        { claim: 'Code review', verdict: 'contradicted' as const, evidence: 'No Agent call' },
      ],
      contractVerification: [
        { obligation: 'executing-plans first', verdict: 'fulfilled' as const, evidence: 'MSG-012' },
      ],
      planVsReality: {
        planFound: true,
        requirements: [
          { requirement: 'Move workers', verdict: 'implemented' as const, evidence: 'MSG-078' },
        ],
      },
      anomalies: [
        {
          type: 'fabrication' as const,
          severity: 'critical' as const,
          evidence: 'MSG-048',
          detail: 'Lied about review',
        },
      ],
    };

    const comment = formatPrComment(result);
    expect(comment).toContain('### Deep Validation Report');
    expect(comment).toContain('Claim Verification');
    expect(comment).toContain('✅ verified');
    expect(comment).toContain('❌ contradicted');
    expect(comment).toContain('Contract Verification');
    expect(comment).toContain('Plan vs Reality');
    expect(comment).toContain('Plan found: ✅');
    expect(comment).toContain('Anomalies');
    expect(comment).toContain('🔴 critical');
  });

  it('formats empty sections', () => {
    const result = {
      claimVerification: [],
      contractVerification: [],
      planVsReality: { planFound: false, requirements: [] },
      anomalies: [],
    };

    const comment = formatPrComment(result);
    expect(comment).toContain('No claims verified.');
    expect(comment).toContain('No contracts verified.');
    expect(comment).toContain('❌ No plan file found on branch');
    expect(comment).not.toContain('Anomalies');
  });

  it('renders partially and unverifiable verdicts', () => {
    const result = {
      claimVerification: [
        { claim: 'Something', verdict: 'unverifiable' as const, evidence: 'MSG-001' },
      ],
      contractVerification: [
        { obligation: 'Unused', verdict: 'not_applicable' as const, evidence: 'N/A' },
      ],
      planVsReality: {
        planFound: true,
        requirements: [
          { requirement: 'Partial', verdict: 'partially' as const, evidence: 'MSG-002' },
        ],
      },
      anomalies: [
        {
          type: 'laziness' as const,
          severity: 'warning' as const,
          evidence: 'MSG-003',
          detail: 'Skipped steps',
        },
        {
          type: 'skipped_step' as const,
          severity: 'info' as const,
          evidence: 'MSG-004',
          detail: 'FYI',
        },
      ],
    };

    const comment = formatPrComment(result);
    expect(comment).toContain('❓ unverifiable');
    expect(comment).toContain('❓ not_applicable');
    expect(comment).toContain('⚠️ partially');
    expect(comment).toContain('🟡 warning');
    expect(comment).toContain('🔵 info');
  });
});

describe('buildDeepValidationPrompt edge cases', () => {
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
