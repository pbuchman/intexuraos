import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import {
  ResumeSummaryExtractor,
  RESUME_SUMMARY_SCHEMA,
  resumeSummaryPrompt,
  getLast50Lines,
  getLast50ClaudeLines,
  getLast20Lines,
  detectFatalExitCode,
  getVerifierTaskId,
  verifyCompletion,
} from '../completion-verifier.js';
import { countMeaningfulTranscriptLines } from '../completion-verifier/transcript.js';

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

function fakeClient(
  response: { ok: true; content: string } | { ok: false; code: string }
): LlmGenerateClient {
  return {
    generate: vi.fn().mockImplementation(() => {
      if (response.ok) {
        return Promise.resolve({ ok: true, value: { content: response.content } });
      }
      return Promise.resolve({ ok: false, error: { code: response.code } });
    }),
  } as unknown as LlmGenerateClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RESUME_SUMMARY_SCHEMA', () => {
  it('accepts {summary: string}', () => {
    expect(RESUME_SUMMARY_SCHEMA.safeParse({ summary: 'ok' }).success).toBe(true);
  });
  it('rejects missing summary', () => {
    expect(RESUME_SUMMARY_SCHEMA.safeParse({}).success).toBe(false);
  });
});

describe('resumeSummaryPrompt', () => {
  it('embeds transcript and instructs JSON-only response', () => {
    const p = resumeSummaryPrompt.build({ transcript: 'X' });
    expect(p).toContain('JSON');
    expect(p.endsWith('X')).toBe(true);
  });
});

describe('transcript helpers', () => {
  it('getLast50Lines returns trailing 50 lines', () => {
    const logs = Array.from({ length: 80 }, (_, i) => `line ${String(i)}`).join('\n');
    expect(getLast50Lines(logs).split('\n')).toHaveLength(50);
  });

  it('getLast50ClaudeLines filters for [claude] prefix', () => {
    const logs = ['[orchestrator] meta', '[claude] one', '[hook] hook', '[claude] two'].join('\n');
    const out = getLast50ClaudeLines(logs).split('\n');
    expect(out).toEqual(['[claude] one', '[claude] two']);
  });

  it('getLast20Lines returns trailing 20 lines', () => {
    const logs = Array.from({ length: 30 }, (_, i) => `line ${String(i)}`).join('\n');
    expect(getLast20Lines(logs).split('\n')).toHaveLength(20);
  });

  it('detectFatalExitCode returns 137 for SIGKILL marker in last 5 lines', () => {
    const logs = [
      'line 1',
      'line 2',
      '[entrypoint] Claude attempt finished with exit code: 137',
    ].join('\n');
    expect(detectFatalExitCode(logs)).toBe(137);
  });

  it('detectFatalExitCode returns undefined when marker is absent', () => {
    expect(detectFatalExitCode('nothing fatal here')).toBeUndefined();
  });

  it('[INT-1470 coverage] countMeaningfulTranscriptLines skips infrastructure prefixes', () => {
    const lines = [
      '[orchestrator] setup',
      '[hook] pre',
      '[entrypoint] running',
      '[system] info',
      '[claude] real agent output',
      'plain line',
    ];
    // 2 non-infrastructure lines: '[claude] real agent output' and 'plain line'
    expect(countMeaningfulTranscriptLines(lines)).toBe(2);
  });

  it('[INT-1470 coverage] countMeaningfulTranscriptLines counts all when no infrastructure prefixes', () => {
    const lines = ['[claude] a', '[claude] b', 'c'];
    expect(countMeaningfulTranscriptLines(lines)).toBe(3);
  });
});

describe('verifyCompletion (thin smoke — full matrix lives in __tests__/completion-verifier.test.ts)', () => {
  it('returns hard-error when the transcript has no AGENT_FINAL block', () => {
    const verdict = verifyCompletion({
      transcript: 'plain text',
      agentType: 'execution',
      workerType: 'opus',
      executionMemoryContext: undefined,
      lastExitCode: 0,
    });
    expect(verdict.kind).toBe('hard-error');
  });

  it('returns parsed when the transcript has a valid EXECUTION_AGENT_FINAL block', () => {
    const verdict = verifyCompletion({
      transcript: [
        'EXECUTION_AGENT_FINAL:',
        '- Outcome: implemented',
        '- pr: https://github.com/x/y/pull/1',
        '- summary: ok',
      ].join('\n'),
      agentType: 'execution',
      workerType: 'opus',
      executionMemoryContext: undefined,
      lastExitCode: 0,
    });
    expect(verdict.kind).toBe('parsed');
    if (verdict.kind !== 'parsed') return;
    expect(verdict.missingRequired).toEqual([]);
    expect(verdict.data['outcome']).toBe('implemented');
  });

  it('rejects successful Sentry outcomes when the final block has no PR URL', () => {
    const verdict = verifyCompletion({
      transcript: [
        'SENTRY_AGENT_FINAL:',
        '- outcome: fixed',
        '- pr: ',
        '- sentry_issue: https://intexura.sentry.io/issues/123456/',
        '- linear_issue: https://linear.app/pbuchman/issue/INT-123/sentry-typeerror',
        '- verification: pnpm run test:sentry',
        '- reproduction: reproduced with webhook fixture',
        '- summary: Fixed issue',
      ].join('\n'),
      agentType: 'sentry',
      workerType: 'codex-xhigh',
      executionMemoryContext: undefined,
      lastExitCode: 0,
    });

    expect(verdict.kind).toBe('parsed');
    if (verdict.kind !== 'parsed') return;
    expect(verdict.missingRequired).toContain('pr');
  });

  it('accepts suppressed Sentry outcomes with PR and evidence fields', () => {
    const verdict = verifyCompletion({
      transcript: [
        'SENTRY_AGENT_FINAL:',
        '- outcome: suppressed',
        '- pr: https://github.com/pbuchman/intexuraos/pull/123',
        '- sentry_issue: https://intexura.sentry.io/issues/123456/',
        '- linear_issue: https://linear.app/pbuchman/issue/INT-123/sentry-typeerror',
        '- verification: pnpm run test:sentry',
        '- reproduction: not feasible because payload needs production-only provider data',
        '- suppression_rationale: Report is a documented third-party cancellation path.',
        '- summary: Suppressed non-error report in code',
      ].join('\n'),
      agentType: 'sentry',
      workerType: 'codex-xhigh',
      executionMemoryContext: undefined,
      lastExitCode: 0,
    });

    expect(verdict.kind).toBe('parsed');
    if (verdict.kind !== 'parsed') return;
    expect(verdict.missingRequired).toEqual([]);
    expect(verdict.data['outcome']).toBe('suppressed');
    expect(verdict.data['pr']).toBe('https://github.com/pbuchman/intexuraos/pull/123');
  });
});

describe('ResumeSummaryExtractor', () => {
  it('extracts summary from a primary JSON response', async () => {
    const extractor = new ResumeSummaryExtractor(logger, {
      primaryClient: fakeClient({ ok: true, content: '{"summary":"did stuff"}' }),
      primaryModelName: 'primary',
      fallbackClients: [],
    });
    const summary = await extractor.extractResumeSummary('task_1', 'rawLogs');
    expect(summary).toBe('did stuff');
  });

  it('falls through to a fallback when primary generate fails', async () => {
    const extractor = new ResumeSummaryExtractor(logger, {
      primaryClient: fakeClient({ ok: false, code: 'rate_limited' }),
      primaryModelName: 'primary',
      fallbackClients: [fakeClient({ ok: true, content: '{"summary":"ok-fb"}' })],
      fallbackModelNames: ['fallback-1'],
    });
    const summary = await extractor.extractResumeSummary('task_1', 'rawLogs');
    expect(summary).toBe('ok-fb');
  });

  it('returns undefined when all models fail', async () => {
    const extractor = new ResumeSummaryExtractor(logger, {
      primaryClient: fakeClient({ ok: false, code: 'rate_limited' }),
      primaryModelName: 'primary',
      fallbackClients: [fakeClient({ ok: false, code: 'timeout' })],
    });
    const summary = await extractor.extractResumeSummary('task_1', 'rawLogs');
    expect(summary).toBeUndefined();
  });

  it('returns undefined when the response is not valid JSON', async () => {
    const extractor = new ResumeSummaryExtractor(logger, {
      primaryClient: fakeClient({ ok: true, content: 'not json' }),
      primaryModelName: 'primary',
      fallbackClients: [],
    });
    const summary = await extractor.extractResumeSummary('task_1', 'rawLogs');
    expect(summary).toBeUndefined();
  });

  it('returns undefined when the response JSON fails Zod validation', async () => {
    const extractor = new ResumeSummaryExtractor(logger, {
      primaryClient: fakeClient({ ok: true, content: '{"wrong_key":"x"}' }),
      primaryModelName: 'primary',
      fallbackClients: [],
    });
    const summary = await extractor.extractResumeSummary('task_1', 'rawLogs');
    expect(summary).toBeUndefined();
  });

  it('describes itself as enabled', () => {
    const extractor = new ResumeSummaryExtractor(logger, {
      primaryClient: fakeClient({ ok: true, content: '{}' }),
      primaryModelName: 'primary',
      fallbackClients: [],
    });
    expect(extractor.describe().enabled).toBe(true);
  });
});

describe('getVerifierTaskId', () => {
  it('returns null outside of a verifier context', () => {
    expect(getVerifierTaskId()).toBeNull();
  });
});
