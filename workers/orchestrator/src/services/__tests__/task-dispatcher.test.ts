import { describe, expect, it } from 'vitest';

const { buildMissingFieldsPrompt } = await import('../task-dispatcher.js');

// ---------------------------------------------------------------------------
// buildMissingFieldsPrompt (post-INT-1470: deliverable-only; telemetry misses
// never trigger a retry so the memory guidance branches have been removed)
// ---------------------------------------------------------------------------

describe('buildMissingFieldsPrompt', () => {
  const rawLogs = 'line1\nline2\nline3';

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

  it('does NOT emit the legacy EXECUTION MEMORY REPORTING FAILURE branch', () => {
    const result = buildMissingFieldsPrompt(
      'execution',
      ['memory_acknowledgment', 'memory_ids_unaccounted'],
      rawLogs
    );
    expect(result).not.toContain('EXECUTION MEMORY REPORTING FAILURE');
  });

  it('does NOT emit the legacy MEMORY ACKNOWLEDGMENT BLOCK guidance', () => {
    const result = buildMissingFieldsPrompt('review', ['memory_acknowledgment'], rawLogs);
    expect(result).not.toContain('MEMORY ACKNOWLEDGMENT BLOCK MISSING');
    expect(result).not.toContain('Execution Memories Received');
  });
});
