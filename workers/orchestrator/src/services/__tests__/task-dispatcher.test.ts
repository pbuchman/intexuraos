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

  it('includes the acknowledgment block template and injected IDs when memory_acknowledgment is missing', () => {
    const result = buildMissingFieldsPrompt('review', ['memory_acknowledgment'], rawLogs, {
      applicationId: 'app-1',
      retrievalVersion: 'execution-memory-retrieval@3.0.0',
      querySummary: 'q',
      matchedMemories: [
        {
          memoryId: 'mem_aaa',
          title: 'First memory',
          memoryType: 'pitfall_pattern',
          score: 0.9,
          appliesWhen: 'x',
          action: 'x',
          avoid: 'x',
          verification: 'x',
        },
        {
          memoryId: 'mem_bbb',
          title: 'Second memory',
          memoryType: 'review_finding',
          score: 0.8,
          appliesWhen: 'y',
          action: 'y',
          avoid: 'y',
          verification: 'y',
        },
      ],
    });

    expect(result).toContain('MEMORY ACKNOWLEDGMENT BLOCK MISSING');
    expect(result).toContain('📋 **Execution Memories Received:**');
    expect(result).toContain('- [<n>] <memoryId> — "<title>" — APPLICABLE|NOT APPLICABLE because');
    expect(result).toContain('mem_aaa');
    expect(result).toContain('mem_bbb');
    expect(result).toContain('start of a new line');
  });

  it('omits the acknowledgment block template when memory_acknowledgment is NOT missing', () => {
    const result = buildMissingFieldsPrompt('review', ['memory_ids_used'], rawLogs, {
      applicationId: 'app-1',
      retrievalVersion: 'execution-memory-retrieval@3.0.0',
      querySummary: 'q',
      matchedMemories: [
        {
          memoryId: 'mem_aaa',
          title: 'First memory',
          memoryType: 'pitfall_pattern',
          score: 0.9,
          appliesWhen: 'x',
          action: 'x',
          avoid: 'x',
          verification: 'x',
        },
      ],
    });

    expect(result).not.toContain('MEMORY ACKNOWLEDGMENT BLOCK MISSING');
    expect(result).toContain('EXECUTION MEMORY REPORTING FAILURE:');
  });

  it('includes both the block template AND the triplet guidance when both classes of memory field are missing', () => {
    const result = buildMissingFieldsPrompt(
      'review',
      ['memory_acknowledgment', 'memory_ids_used'],
      rawLogs,
      {
        applicationId: 'app-1',
        retrievalVersion: 'execution-memory-retrieval@3.0.0',
        querySummary: 'q',
        matchedMemories: [
          {
            memoryId: 'mem_aaa',
            title: 'First',
            memoryType: 'pitfall_pattern',
            score: 0.9,
            appliesWhen: 'x',
            action: 'x',
            avoid: 'x',
            verification: 'x',
          },
        ],
      }
    );

    expect(result).toContain('MEMORY ACKNOWLEDGMENT BLOCK MISSING');
    expect(result).toContain('EXECUTION MEMORY REPORTING FAILURE:');
  });

  it('accepts missing executionMemoryContext and still mentions acknowledgment when flagged', () => {
    const result = buildMissingFieldsPrompt('review', ['memory_acknowledgment'], rawLogs);
    expect(result).toContain('MEMORY ACKNOWLEDGMENT BLOCK MISSING');
    expect(result).toContain('📋 **Execution Memories Received:**');
  });
});
