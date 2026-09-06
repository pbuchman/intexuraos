import { describe, it, expect, vi } from 'vitest';
import {
  FATAL_EXIT_CODE_PREFIX,
  INACTIVITY_RESTART_PROMPT,
  getTaskEventUrl,
  hasFatalExitCodeField,
  missingFieldsPrompt,
  buildResumePreamble,
  buildActiveGoalSection,
  parseRebaseResultOutput,
  parseContinuationPrOutput,
} from '../../../services/task-dispatcher/prompts.js';
import type { Task } from '../../../types/task.js';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};

describe('FATAL_EXIT_CODE_PREFIX + hasFatalExitCodeField', () => {
  it('exposes the canonical fatal-exit prefix', () => {
    expect(FATAL_EXIT_CODE_PREFIX).toBe('fatal_exit_code_');
  });

  it('returns the matching field when one is present', () => {
    expect(hasFatalExitCodeField(['summary', 'fatal_exit_code_137'])).toBe('fatal_exit_code_137');
  });

  it('returns undefined when no fatal-exit field is present', () => {
    expect(hasFatalExitCodeField(['summary', 'gh_pr_url'])).toBeUndefined();
  });

  it('returns undefined for an empty field list', () => {
    expect(hasFatalExitCodeField([])).toBeUndefined();
  });
});

describe('INACTIVITY_RESTART_PROMPT', () => {
  it('names the kill reason and instructs resuming from state', () => {
    expect(INACTIVITY_RESTART_PROMPT).toContain('unresponsive');
    expect(INACTIVITY_RESTART_PROMPT).toContain('Continue working');
  });
});

describe('getTaskEventUrl', () => {
  it('swaps task-complete path for task-event path', () => {
    expect(getTaskEventUrl('https://api.test/internal/webhooks/task-complete')).toBe(
      'https://api.test/internal/webhooks/task-event'
    );
  });

  it('derives the task-event endpoint from a callback owner without the canonical marker', () => {
    expect(getTaskEventUrl('https://api.test/other/path')).toBe(
      'https://api.test/internal/webhooks/task-event'
    );
  });
});

describe('missingFieldsPrompt', () => {
  const rawLogs = 'first-line\nsecond-line\nthird-line';

  it('has correct metadata', () => {
    expect(missingFieldsPrompt.name).toBe('missing-fields-resume');
    expect(missingFieldsPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('includes the missing fields, agent type, transcript, and constraints', () => {
    const result = missingFieldsPrompt.build({
      agentType: 'planning',
      missingFields: ['summary'],
      rawLogs,
    });
    expect(result).toContain('[AUTO-CONTINUE ATTEMPT]');
    expect(result).toContain('Missing fields: summary');
    expect(result).toContain('Agent type: planning');
    expect(result).toContain('Last 50 lines of transcript for reference:');
    expect(result).toContain('first-line');
    expect(result).toContain('- Do not restart from scratch.');
  });

  it('[INT-1470] resume prompt does NOT mention EXECUTION MEMORY REPORTING FAILURE', () => {
    // Telemetry-only retries are gone — the only resume prompt is for
    // deliverable misses (outcome / pr / summary). Telemetry misses are
    // warn-only and never trigger a retry.
    const result = missingFieldsPrompt.build({
      agentType: 'execution',
      missingFields: ['memory_ids_used', 'memory_ids_rejected'],
      rawLogs,
    });
    expect(result).not.toContain('EXECUTION MEMORY REPORTING FAILURE');
  });

  it('[INT-1470] resume prompt does NOT emit memory-acknowledgment guidance', () => {
    const result = missingFieldsPrompt.build({
      agentType: 'execution',
      missingFields: ['memory_acknowledgment'],
      rawLogs,
      executionMemoryContext: {
        matchedMemories: [
          { memoryId: 'mem_123', title: 'Sample', type: 't', score: 1, content: 'x' },
        ],
        totalMatched: 1,
      } as never,
    });
    expect(result).not.toContain('Execution Memories Received');
    expect(result).not.toContain('Injected memory IDs you MUST acknowledge');
    // It still lists the missing field name by virtue of the standard resume header.
    expect(result).toContain('memory_acknowledgment');
  });
});

describe('buildResumePreamble', () => {
  it('uses the default gh pr view command when no continuationPrNumber is set', () => {
    const preamble = buildResumePreamble();
    expect(preamble).toContain('gh pr view --json state,mergedAt,number');
    expect(preamble).toContain('If PR is MERGED or CLOSED or NO_PR:');
    expect(preamble).toContain('If PR is OPEN:');
  });

  it('uses the numbered gh pr view command when continuationPrNumber is set', () => {
    const task = { continuationPrNumber: 42 } as Task;
    const preamble = buildResumePreamble(task);
    expect(preamble).toContain('gh pr view 42 --json state,mergedAt,number');
  });

  it('swaps in the push-origin instruction when continuationPrBranch is set', () => {
    const task = {
      continuationPrNumber: 42,
      continuationPrBranch: 'feature/int-100',
    } as Task;
    const preamble = buildResumePreamble(task);
    expect(preamble).toContain('git push origin HEAD:feature/int-100');
    expect(preamble).toContain(
      'If the message below references a PR comment or review, address it'
    );
  });
});

describe('buildActiveGoalSection', () => {
  it('strips the resume preamble and appends the active goal block', () => {
    const preamble = buildResumePreamble();
    const prompt = preamble + 'Do this next.';
    const section = buildActiveGoalSection(undefined, prompt);
    expect(section).toContain('[ACTIVE GOAL — HIGHEST PRIORITY]');
    expect(section).toContain('Do this next.');
    expect(section).not.toContain('If PR is OPEN:');
  });

  it('preserves the prompt verbatim when the preamble is not present', () => {
    const section = buildActiveGoalSection(undefined, 'naked prompt');
    expect(section).toContain('[ACTIVE GOAL — HIGHEST PRIORITY]');
    expect(section).toContain('naked prompt');
  });
});

describe('parseRebaseResultOutput', () => {
  it('returns a typed rebaseResult object for a well-formed attempt', () => {
    const output = JSON.stringify({
      attempted: true,
      success: false,
      conflictFiles: ['a.ts', 'b.ts'],
    });
    const result = parseRebaseResultOutput(output, 'task-1', mockLogger as never);
    expect(result).toEqual({
      attempted: true,
      success: false,
      conflictFiles: ['a.ts', 'b.ts'],
    });
  });

  it('returns not-required rebase evidence for attempted=false', () => {
    const output = JSON.stringify({ attempted: false });
    const result = parseRebaseResultOutput(output, 'task-1', mockLogger as never);
    expect(result).toEqual({ attempted: false, reason: 'not_required' });
  });

  it('returns undefined when the JSON does not include attempted=true', () => {
    const result = parseRebaseResultOutput('{}', 'task-1', mockLogger as never);
    expect(result).toBeUndefined();
  });

  it('returns undefined and logs a warning for malformed JSON', () => {
    mockLogger.warn.mockReset();
    const result = parseRebaseResultOutput('{ bad json', 'task-1', mockLogger as never);
    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' }),
      'Failed to parse rebase result'
    );
  });
});

describe('parseContinuationPrOutput', () => {
  it('parses a well-formed JSON response from gh pr view', () => {
    const payload = {
      url: 'https://github.com/pr/1',
      number: 1,
      headRefName: 'feature/x',
      title: 't',
      state: 'OPEN',
      mergedAt: null,
    };
    expect(
      parseContinuationPrOutput('task-1', JSON.stringify(payload), mockLogger as never)
    ).toEqual(payload);
  });

  it('returns undefined and logs a warning when the output is not valid JSON', () => {
    mockLogger.warn.mockReset();
    expect(parseContinuationPrOutput('task-1', 'not json', mockLogger as never)).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' }),
      'Failed to parse continuation PR output'
    );
  });
});
