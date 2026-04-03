import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { readFile } from 'node:fs/promises';
import type { AgentComplianceReport } from '../compliance-report-schema.js';

const { createOpenRouterClientMock, execFileMock } = vi.hoisted(() => ({
  createOpenRouterClientMock: vi.fn(),
  execFileMock: vi.fn(),
}));

vi.mock('@intexuraos/infra-openrouter', () => ({
  createOpenRouterClient: createOpenRouterClientMock,
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

const {
  buildCompliancePrompt,
  renderComplianceMarkdown,
  AGENT_COMPLIANCE_PROMPT_VERSION,
  OrchestratorAgentComplianceValidator,
} = await import('../agent-compliance-validator.js');

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
  openRouterApiKey: 'test-key',
  model: 'anthropic/claude-sonnet-4',
  pricing: {
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
  },
  auditLogPath: '/tmp/compliance-validator-audit.test.log',
};

const defaultClaims = {
  outcome: 'implemented' as const,
  superpowers_subagent_driven_dev: 'used' as const,
  superpowers_requesting_code_review: 'used' as const,
  gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1071',
  memory_ids_used: '',
  memory_ids_rejected: '',
  memory_usage_summary: '',
  summary: 'Implemented the fix.',
};

const defaultInput = {
  taskId: 'task_abc',
  prNumber: 1071,
  repository: 'pbuchman/intexuraos',
  formattedTranscript: '[MSG-001] ASSISTANT tool_use: Bash\n  command: "pnpm run ci:tracked"',
  agentClaims: defaultClaims,
  workerType: 'auto',
};

const validReport: AgentComplianceReport = {
  claimVerification: {
    ciTrackedCalled: { called: true, exitCode: 0, msgRef: 'MSG-001' },
    prCreated: {
      created: true,
      url: 'https://github.com/pbuchman/intexuraos/pull/1071',
      msgRef: 'MSG-050',
    },
    commitCount: 3,
    summaryAccurate: true,
    summaryContradictions: [],
  },
  contractCompliance: {
    subagentDrivenDevInvoked: { invoked: true, msgRef: 'MSG-005' },
    requestingCodeReviewInvoked: { invoked: true, msgRef: 'MSG-040' },
    codeReviewerDispatched: { dispatched: true, msgRef: 'MSG-041' },
    correctOrder: true,
    skillViolations: [],
  },
  anomalies: [],
  executionMetrics: {
    totalMessages: 60,
    hookViolationCount: 0,
    toolErrorCount: 2,
    subagentDispatchCount: 4,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  postedCommentBodies.length = 0;
  createOpenRouterClientMock.mockReturnValue({ generate: generateMock });
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

describe('buildCompliancePrompt', () => {
  it('includes claims JSON, transcript, schema shape, and key sections', () => {
    const result = buildCompliancePrompt({
      formattedTranscript: '[MSG-001] test transcript',
      agentClaims: defaultClaims,
      workerType: 'auto',
    });

    expect(result.ok).toBe(true);
    const prompt = (result as { ok: true; prompt: string }).prompt;
    expect(prompt).toContain('[agent-compliance-prompt v' + AGENT_COMPLIANCE_PROMPT_VERSION + ']');
    expect(prompt).toContain('"outcome": "implemented"');
    expect(prompt).toContain('"superpowers_subagent_driven_dev": "used"');
    expect(prompt).toContain('"gh_pr_url"');
    expect(prompt).toContain('[MSG-001] test transcript');
    expect(prompt).toContain('claimVerification');
    expect(prompt).toContain('contractCompliance');
    expect(prompt).toContain('anomalies');
    expect(prompt).toContain('executionMetrics');
    expect(prompt).toContain('Return ONLY valid JSON');
    expect(prompt).toContain('MSG-NNN');
  });

  it('returns TRANSCRIPT_TOO_LONG for oversized transcripts', () => {
    const oversized = 'A'.repeat(720_001);
    const result = buildCompliancePrompt({
      formattedTranscript: oversized,
      agentClaims: defaultClaims,
      workerType: 'auto',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('TRANSCRIPT_TOO_LONG');
    }
  });

  it('does not return TRANSCRIPT_TOO_LONG for exactly max-length transcript', () => {
    const exactlyMax = 'A'.repeat(720_000);
    const result = buildCompliancePrompt({
      formattedTranscript: exactlyMax,
      agentClaims: defaultClaims,
      workerType: 'auto',
    });
    expect(result.ok).toBe(true);
  });
});

describe('renderComplianceMarkdown', () => {
  it('produces consistent markdown with @ignore, heading, tables, and emoji severity', () => {
    const reportWithAnomalies: AgentComplianceReport = {
      ...validReport,
      anomalies: [
        {
          type: 'fabrication',
          severity: 'critical',
          msgRef: 'MSG-042',
          description: 'Agent claimed CI passed but exit code was 1',
        },
        {
          type: 'ignored_error',
          severity: 'warning',
          msgRef: 'MSG-030',
          description: 'Build error was logged but agent continued',
        },
        {
          type: 'laziness',
          severity: 'minor',
          msgRef: 'MSG-055',
          description: 'Agent skipped running tests after minor refactor',
        },
      ],
      claimVerification: {
        ...validReport.claimVerification,
        summaryAccurate: false,
        summaryContradictions: ['Claimed all tests pass but CI exit code was 1'],
      },
    };
    const markdown = renderComplianceMarkdown(reportWithAnomalies, {
      costUsd: 0.042567,
      model: 'anthropic/claude-sonnet-4',
      promptVersion: '1.0.0',
    });
    expect(markdown).toMatch(/^@ignore\n/u);
    expect(markdown).toContain('### Agent Compliance Report');
    expect(markdown).toContain('**Cost:** $0.042567');
    expect(markdown).toContain('**Model:** anthropic/claude-sonnet-4');
    expect(markdown).toContain('\u{1F534}');
    expect(markdown).toContain('\u{1F7E0}');
    expect(markdown).toContain('\u{1F7E1}');
    expect(markdown).toContain('Claim Verification');
    expect(markdown).toContain('Contract Compliance');
    expect(markdown).toContain('Anomalies');
    expect(markdown).toContain('MSG-042');
    expect(markdown).toContain('fabrication');
  });

  it('renders pass emoji for clean reports', () => {
    const markdown = renderComplianceMarkdown(validReport, {
      costUsd: 0.01,
      model: 'test-model',
      promptVersion: '1.0.0',
    });
    expect(markdown).toContain('\u{1F7E2}');
    expect(markdown).toContain('No anomalies');
  });

  it('renders critical emoji for failed claims and non-compliant contract', () => {
    const failedReport: AgentComplianceReport = {
      claimVerification: {
        ciTrackedCalled: { called: false, exitCode: null, msgRef: null },
        prCreated: { created: false, url: null, msgRef: null },
        commitCount: 0,
        summaryAccurate: true,
        summaryContradictions: [],
      },
      contractCompliance: {
        subagentDrivenDevInvoked: { invoked: false, msgRef: null },
        requestingCodeReviewInvoked: { invoked: false, msgRef: null },
        codeReviewerDispatched: { dispatched: false, msgRef: null },
        correctOrder: false,
        skillViolations: ['Skills were loaded out of order'],
      },
      anomalies: [],
      executionMetrics: {
        totalMessages: 10,
        hookViolationCount: 0,
        toolErrorCount: 0,
        subagentDispatchCount: 0,
      },
    };
    const markdown = renderComplianceMarkdown(failedReport, {
      costUsd: 0.01,
      model: 'test-model',
      promptVersion: '1.0.0',
    });
    // CI tracked called should show critical (false branch)
    expect(markdown).toContain('\u{1F534} Critical');
    // Skill violations should be rendered
    expect(markdown).toContain('Skills were loaded out of order');
    // N/A for null msgRefs
    expect(markdown).toContain('N/A');
  });
});

describe('OrchestratorAgentComplianceValidator', () => {
  it('happy path: returns structured report and posts PR comment', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: {
        content: JSON.stringify(validReport),
        usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.042 },
      },
    });
    const validator = new OrchestratorAgentComplianceValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);
    expect(result).not.toBeNull();
    expect(result?.report).toEqual(validReport);
    expect(result?.transcriptTooLong).toBe(false);
    expect(result?.costUsd).toBe(0.042);
    expect(result?.model).toBe('anthropic/claude-sonnet-4');
    expect(result?.promptVersion).toBe(AGENT_COMPLIANCE_PROMPT_VERSION);
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
    expect(bodyArg).toContain('### Agent Compliance Report');
    expect(bodyArg).toContain('@ignore');
    const progressCalls = onProgress.mock.calls.map((call) => String(call[0]));
    expect(progressCalls).toContain('calling OpenRouter for compliance analysis...');
    expect(progressCalls).toContain('compliance response received');
    expect(progressCalls).toContain('posting PR comment...');
    expect(progressCalls).toContain('PR comment posted');
  });

  it('strips code fences from response before parsing', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: {
        content: '```json\n' + JSON.stringify(validReport) + '\n```',
        usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.042 },
      },
    });
    const validator = new OrchestratorAgentComplianceValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);
    expect(result).not.toBeNull();
    expect(result?.report).toEqual(validReport);
  });

  it('repair flow: first response fails Zod, second succeeds', async () => {
    const invalidResponse = JSON.stringify({ invalid: true });
    generateMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          content: invalidResponse,
          usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.02 },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify(validReport),
          usage: { inputTokens: 800, outputTokens: 400, totalTokens: 1200, costUsd: 0.018 },
        },
      });
    const validator = new OrchestratorAgentComplianceValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);
    expect(result).not.toBeNull();
    expect(result?.report).toEqual(validReport);
    expect(result?.costUsd).toBe(0.038);
    expect(generateMock).toHaveBeenCalledTimes(2);
    const repairCallArgs = generateMock.mock.calls[1]?.[0] as string;
    expect(repairCallArgs).toContain('invalid');
    const progressCalls = onProgress.mock.calls.map((call) => String(call[0]));
    expect(progressCalls).toContain('Zod validation failed, attempting repair...');
  });

  it('returns null when both initial and repair calls fail Zod validation', async () => {
    generateMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({ invalid: true }),
          usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.02 },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({ stillInvalid: true }),
          usage: { inputTokens: 800, outputTokens: 400, totalTokens: 1200, costUsd: 0.018 },
        },
      });
    const validator = new OrchestratorAgentComplianceValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);
    expect(result).toBeNull();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_abc' }),
      expect.stringContaining('repair also failed')
    );
  });

  it('transcript too long: returns transcriptTooLong true and posts comment', async () => {
    const longInput = { ...defaultInput, formattedTranscript: 'A'.repeat(720_001) };
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
    const validator = new OrchestratorAgentComplianceValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(longInput, onProgress);
    expect(result).not.toBeNull();
    expect(result?.transcriptTooLong).toBe(true);
    expect(result?.report).toBeNull();
    expect(generateMock).not.toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const bodyArg = postedCommentBodies[0] ?? '';
    expect(bodyArg).toContain('transcript too long');
  });

  it('returns null when LLM call fails', async () => {
    generateMock.mockResolvedValue({
      ok: false,
      error: { code: 'API_ERROR', message: 'service unavailable' },
    });
    const validator = new OrchestratorAgentComplianceValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);
    expect(result).toBeNull();
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_abc' }),
      'Compliance validation LLM call failed'
    );
    const progressCalls = onProgress.mock.calls.map((call) => String(call[0]));
    expect(progressCalls[1]).toContain('LLM call failed');
  });

  it('returns result even when PR comment posting fails', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: {
        content: JSON.stringify(validReport),
        usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.042 },
      },
    });
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error('gh CLI not found'));
      }
    );
    const validator = new OrchestratorAgentComplianceValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);
    expect(result).not.toBeNull();
    expect(result?.report).toEqual(validReport);
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_abc' }),
      'Failed to post compliance validation PR comment'
    );
  });

  it('works without onProgress callback', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: {
        content: JSON.stringify(validReport),
        usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.042 },
      },
    });
    const validator = new OrchestratorAgentComplianceValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);
    expect(result).not.toBeNull();
    expect(result?.report).toEqual(validReport);
  });

  it('returns null when repair LLM call itself fails', async () => {
    generateMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify({ invalid: true }),
          usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.02 },
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'TIMEOUT', message: 'request timed out' },
      });
    const validator = new OrchestratorAgentComplianceValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);
    expect(result).toBeNull();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_abc' }),
      expect.stringContaining('repair LLM call failed')
    );
  });

  it('repair flow: still returns report when PR comment posting fails', async () => {
    const invalidResponse = JSON.stringify({ invalid: true });
    generateMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          content: invalidResponse,
          usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.02 },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          content: JSON.stringify(validReport),
          usage: { inputTokens: 800, outputTokens: 400, totalTokens: 1200, costUsd: 0.018 },
        },
      });
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error('gh failed'));
      }
    );
    const validator = new OrchestratorAgentComplianceValidator(logger, defaultConfig);
    const onProgress = vi.fn();
    const result = await validator.validate(defaultInput, onProgress);
    expect(result).not.toBeNull();
    expect(result?.report).toEqual(validReport);
    const progressCalls = onProgress.mock.calls.map((call) => String(call[0]));
    expect(progressCalls).toContain('PR comment failed (see server logs)');
  });

  it('logs stderr from gh command errors', async () => {
    generateMock.mockResolvedValue({
      ok: true,
      value: {
        content: JSON.stringify(validReport),
        usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.042 },
      },
    });
    const ghError = new Error('Command failed') as Error & { stderr: string };
    ghError.stderr = 'gh: not logged in';
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(ghError);
      }
    );
    const validator = new OrchestratorAgentComplianceValidator(logger, defaultConfig);
    const result = await validator.validate(defaultInput);
    expect(result).not.toBeNull();
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_abc', stderr: 'gh: not logged in' }),
      'Failed to post compliance validation PR comment'
    );
  });
});
