import { describe, expect, it } from 'vitest';
import type { Task } from '../../types/task.js';

const { missingFieldsPrompt, runVerification } = await import('../task-dispatcher.js');

// ---------------------------------------------------------------------------
// missingFieldsPrompt (post-INT-1470: deliverable-only; telemetry misses
// never trigger a retry so the memory guidance branches have been removed)
// ---------------------------------------------------------------------------

describe('missingFieldsPrompt', () => {
  const rawLogs = 'line1\nline2\nline3';

  it('always includes transcript, agent type, and constraints', () => {
    const logsWithContent = 'alpha\nbeta\ngamma';
    const result = missingFieldsPrompt.build({
      agentType: 'planning',
      missingFields: ['summary'],
      rawLogs: logsWithContent,
    });

    expect(result).toContain('[AUTO-CONTINUE ATTEMPT]');
    expect(result).toContain('Missing fields: summary');
    expect(result).toContain('Agent type: planning');
    expect(result).toContain('Last 50 lines of transcript for reference:');
    expect(result).toContain('alpha\nbeta\ngamma');
    expect(result).toContain('- Do not restart from scratch.');
    expect(result).toContain('- Continue from current repository/worktree state.');
  });

  it('does NOT emit the legacy EXECUTION MEMORY REPORTING FAILURE branch', () => {
    const result = missingFieldsPrompt.build({
      agentType: 'execution',
      missingFields: ['memory_acknowledgment', 'memory_ids_unaccounted'],
      rawLogs,
    });
    expect(result).not.toContain('EXECUTION MEMORY REPORTING FAILURE');
  });

  it('does NOT emit the legacy MEMORY ACKNOWLEDGMENT BLOCK guidance', () => {
    const result = missingFieldsPrompt.build({
      agentType: 'review',
      missingFields: ['memory_acknowledgment'],
      rawLogs,
    });
    expect(result).not.toContain('MEMORY ACKNOWLEDGMENT BLOCK MISSING');
    expect(result).not.toContain('Execution Memories Received');
  });
});

// ---------------------------------------------------------------------------
// runVerification — selects between the test-only verifier override and the
// production `verifyCompletion`. Both arms are exercised here directly so the
// dispatcher-body branch doesn't need a v8 ignore. (v8 ignore on branches is
// not allowed — see .claude/reference/coverage-exemptions.md.)
// ---------------------------------------------------------------------------

describe('runVerification [INT-1470]', () => {
  function makeTask(): Task {
    return {
      taskId: 'task-1',
      workerType: 'sonnet' as Task['workerType'],
      prompt: 'do work',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      webhookUrl: 'https://example.test/webhook',
      webhookSecret: 'secret',
      status: 'running',
      worktreePath: '/tmp/wt',
      containerId: 'container-1',
      linearIssueLabels: [],
      startedAt: '2024-01-01T00:00:00.000Z',
      attemptCount: 1,
      maxAttempts: 3,
      verificationHistory: [],
    };
  }

  it('production path: uses verifyCompletion when no override is set', async () => {
    const verdict = await runVerification({
      verifyOverride: undefined,
      task: makeTask(),
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
      rawLogs: [
        'EXECUTION_AGENT_FINAL:',
        '- Outcome: implemented',
        '- pr: https://github.com/x/y/pull/1',
        '- summary: ok',
      ].join('\n'),
    });
    expect(verdict.kind).toBe('parsed');
    if (verdict.kind !== 'parsed') return;
    expect(verdict.missingRequired).toEqual([]);
  });

  it('production path: returns hard-error when transcript has no AGENT_FINAL block', async () => {
    const verdict = await runVerification({
      verifyOverride: undefined,
      task: makeTask(),
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
      rawLogs: 'no marker at all',
    });
    expect(verdict.kind).toBe('hard-error');
  });

  it('test-override path: routes through the adapter when override is set', async () => {
    const verdict = await runVerification({
      verifyOverride: async () => ({
        passed: true,
        missingFields: [],
        telemetryMissingFields: [],
        verifierFailure: false,
      }),
      task: makeTask(),
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
      rawLogs: 'ignored — override does not read rawLogs',
    });
    expect(verdict.kind).toBe('parsed');
    if (verdict.kind !== 'parsed') return;
    expect(verdict.missingRequired).toEqual([]);
  });

  it('test-override path: threads exitCode into override input when defined', async () => {
    const capturedInputs: unknown[] = [];
    await runVerification({
      verifyOverride: async (input) => {
        capturedInputs.push(input);
        return {
          passed: true,
          missingFields: [],
          telemetryMissingFields: [],
          verifierFailure: false,
        };
      },
      task: makeTask(),
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
      rawLogs: '',
      exitCode: 137,
    });
    expect((capturedInputs[0] as { lastExitCode?: number }).lastExitCode).toBe(137);
  });

  it('test-override path: omits exitCode from override input when undefined', async () => {
    const capturedInputs: unknown[] = [];
    await runVerification({
      verifyOverride: async (input) => {
        capturedInputs.push(input);
        return {
          passed: true,
          missingFields: [],
          telemetryMissingFields: [],
          verifierFailure: false,
        };
      },
      task: makeTask(),
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
      rawLogs: '',
    });
    expect('lastExitCode' in (capturedInputs[0] as Record<string, unknown>)).toBe(false);
  });

  it('test-override path: threads executionMemoryContext into override input when defined', async () => {
    const capturedInputs: unknown[] = [];
    const task = makeTask();
    task.executionMemoryContext = {
      status: 'matched',
      matchedMemories: [{ memoryId: 'mem_a' }],
    } as never;
    await runVerification({
      verifyOverride: async (input) => {
        capturedInputs.push(input);
        return {
          passed: true,
          missingFields: [],
          telemetryMissingFields: [],
          verifierFailure: false,
        };
      },
      task,
      attempt: 1,
      maxAttempts: 3,
      agentType: 'execution',
      rawLogs: '',
    });
    expect(
      (capturedInputs[0] as { executionMemoryContext?: unknown }).executionMemoryContext
    ).toBeDefined();
  });
});
