import { describe, expect, it } from 'vitest';

const { buildMissingFieldsPrompt } = await import('../task-dispatcher.js');

// ---------------------------------------------------------------------------
// buildMissingFieldsPrompt
// ---------------------------------------------------------------------------

describe('buildMissingFieldsPrompt', () => {
  const rawLogs = 'line1\nline2\nline3';

  it('includes memory guidance when memory-related fields are missing', () => {
    const result = buildMissingFieldsPrompt(
      'execution',
      ['memory_acknowledgment', 'memory_ids_unaccounted'],
      rawLogs
    );
    expect(result).toContain('EXECUTION MEMORY REPORTING FAILURE:');
    expect(result).toContain('memory_ids_used: comma-separated IDs of memories you applied');
    expect(result).toContain(
      'memory_ids_rejected: comma-separated IDs of memories you found irrelevant'
    );
    expect(result).toContain(
      'memory_usage_summary: one sentence about how memories influenced your work'
    );
    expect(result).toContain('Every injected memory must appear in either used or rejected.');
    expect(result).toContain('If you did not use any memory, put all IDs in memory_ids_rejected.');
  });

  it('does NOT include memory guidance when only non-memory fields are missing', () => {
    const result = buildMissingFieldsPrompt('execution', ['gh_pr_url', 'summary'], rawLogs);
    expect(result).not.toContain('EXECUTION MEMORY REPORTING FAILURE:');
    expect(result).not.toContain('memory_ids_used:');
  });

  it('includes memory guidance when missing fields are mixed (memory + non-memory)', () => {
    const result = buildMissingFieldsPrompt('execution', ['summary', 'memory_ids_used'], rawLogs);
    expect(result).toContain('EXECUTION MEMORY REPORTING FAILURE:');
  });

  it('always includes transcript, agent type, and constraints', () => {
    const logsWithContent = 'alpha\nbeta\ngamma';
    const result = buildMissingFieldsPrompt('planning', ['summary'], logsWithContent);

    expect(result).toContain('[AUTO-CONTINUE ATTEMPT]');
    expect(result).toContain('Missing fields: summary');
    expect(result).toContain('Agent type: planning');
    expect(result).toContain('Last 50 lines of transcript for reference:');
    expect(result).toContain('alpha\nbeta\ngamma');
    expect(result).toContain('- Do not restart from scratch.');
    expect(result).toContain('- Continue from current repository/worktree state.');
  });

  it('includes the agent type in the output for a memory-failure case', () => {
    const result = buildMissingFieldsPrompt(
      'execution',
      ['memory_ids_used', 'memory_ids_rejected'],
      rawLogs
    );
    expect(result).toContain('Agent type: execution');
    expect(result).toContain('Missing fields: memory_ids_used, memory_ids_rejected');
  });

  it('detects each individual memory field correctly', () => {
    const memoryFields = [
      'memory_acknowledgment',
      'memory_ids_used_invalid',
      'memory_ids_rejected_invalid',
      'memory_ids_overlap',
      'memory_ids_unaccounted',
      'memory_usage_summary',
      'memory_ids_used',
      'memory_ids_rejected',
    ];

    for (const field of memoryFields) {
      const result = buildMissingFieldsPrompt('execution', [field], rawLogs);
      expect(result).toContain('EXECUTION MEMORY REPORTING FAILURE:');
    }
  });
});
