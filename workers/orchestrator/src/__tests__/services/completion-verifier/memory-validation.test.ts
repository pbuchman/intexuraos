import { describe, expect, it } from 'vitest';
import type {
  ExecutionMemoryPromptContext,
  ExecutionMemoryPromptMemory,
} from '../../../types/execution-memory.js';
import {
  buildMemoryAcknowledgmentPattern,
  detectEmptyMemoryFields,
  isTelemetryField,
  partitionMissingFields,
  validateMemoryReporting,
} from '../../../services/completion-verifier/memory-validation.js';

function memory(memoryId: string): ExecutionMemoryPromptMemory {
  return {
    memoryId,
    title: `title for ${memoryId}`,
    memoryType: 'implementation_pattern',
    score: 0.9,
    appliesWhen: 'when',
    action: 'do x',
    avoid: 'y',
    verification: 'z',
  };
}

function ctx(...ids: string[]): ExecutionMemoryPromptContext {
  return {
    applicationId: 'app',
    retrievalVersion: 'v1',
    querySummary: 'summary',
    matchedMemories: ids.map(memory),
  };
}

function ackBlock(ids: string[]): string {
  return [
    '[claude] Execution Memories Received',
    ...ids.map(
      (id, i) => `[claude] - [${String(i + 1)}] ${id} — "title" — APPLICABLE because test`
    ),
  ].join('\n');
}

describe('buildMemoryAcknowledgmentPattern', () => {
  it('matches the canonical `- [N] memId` bullet', () => {
    const pattern = buildMemoryAcknowledgmentPattern('mem_142');
    expect(pattern.test('- [1] mem_142 — "x"')).toBe(true);
  });

  it('matches bullets with a docker/log-driver prefix', () => {
    const pattern = buildMemoryAcknowledgmentPattern('mem_142');
    expect(pattern.test('[claude] - [7] mem_142 — "x"')).toBe(true);
  });

  it('rejects the legacy `[memId]` format (without index bracket)', () => {
    const pattern = buildMemoryAcknowledgmentPattern('mem_142');
    expect(pattern.test('- [mem_142] "x"')).toBe(false);
  });

  it('rejects naked mentions of the memoryId', () => {
    const pattern = buildMemoryAcknowledgmentPattern('mem_142');
    expect(pattern.test('used mem_142 for something')).toBe(false);
    expect(pattern.test('memory_ids_used: mem_142')).toBe(false);
  });

  it('escapes regex metacharacters in memoryId so it does not match a prefix twin', () => {
    const pattern = buildMemoryAcknowledgmentPattern('mem.142');
    // `.` would match any char if unescaped; confirm exact-id matching
    expect(pattern.test('- [1] mem.142 — "x"')).toBe(true);
    expect(pattern.test('- [1] memX142 — "x"')).toBe(false);
  });
});

describe('detectEmptyMemoryFields', () => {
  const parsedEmpty = { memory_ids_used: '', memory_ids_rejected: '' };
  const parsedUsed = { memory_ids_used: 'mem_1', memory_ids_rejected: '' };

  it('returns undefined when no memories were injected', () => {
    expect(detectEmptyMemoryFields('planning', undefined, parsedEmpty)).toBeUndefined();
    expect(detectEmptyMemoryFields('planning', ctx(), parsedEmpty)).toBeUndefined();
  });

  it('[INT-1461] detects empty memory fields for execution agent too (guard was removed so EXECUTION_SCHEMA optional-memory parity holds)', () => {
    expect(detectEmptyMemoryFields('execution', ctx('mem_1'), parsedEmpty)).toEqual([
      'memory_ids_used',
      'memory_ids_rejected',
    ]);
  });

  it('returns the pair of field names when both memory fields are blank', () => {
    expect(detectEmptyMemoryFields('planning', ctx('mem_1'), parsedEmpty)).toEqual([
      'memory_ids_used',
      'memory_ids_rejected',
    ]);
  });

  it('returns undefined when at least one of the two fields is populated', () => {
    expect(detectEmptyMemoryFields('planning', ctx('mem_1'), parsedUsed)).toBeUndefined();
  });
});

describe('validateMemoryReporting', () => {
  const agentDataBase = {
    memory_ids_used: 'mem_1',
    memory_ids_rejected: 'mem_2',
    memory_usage_summary: 'Used mem_1, rejected mem_2.',
  };

  it('no-ops when no memories are injected', () => {
    const result = validateMemoryReporting('logs', ctx(), agentDataBase);
    expect(result).toEqual({ failures: [], softWarnings: [] });
  });

  it('produces failure for empty memory_usage_summary', () => {
    const logs = ackBlock(['mem_1', 'mem_2']);
    const result = validateMemoryReporting(logs, ctx('mem_1', 'mem_2'), {
      ...agentDataBase,
      memory_usage_summary: '',
    });
    expect(result.failures).toContain('memory_usage_summary');
  });

  it('produces failure memory_ids_used_invalid when used ID was not injected', () => {
    const logs = ackBlock(['mem_1']);
    const result = validateMemoryReporting(logs, ctx('mem_1'), {
      ...agentDataBase,
      memory_ids_used: 'mem_NOPE',
      memory_ids_rejected: '',
    });
    expect(result.failures).toContain('memory_ids_used_invalid');
  });

  it('produces failure memory_ids_rejected_invalid when rejected ID was not injected', () => {
    const logs = ackBlock(['mem_1']);
    const result = validateMemoryReporting(logs, ctx('mem_1'), {
      ...agentDataBase,
      memory_ids_used: 'mem_1',
      memory_ids_rejected: 'mem_STRAY',
    });
    expect(result.failures).toContain('memory_ids_rejected_invalid');
  });

  it('produces failure memory_ids_overlap when same ID is both used and rejected', () => {
    const logs = ackBlock(['mem_1']);
    const result = validateMemoryReporting(logs, ctx('mem_1'), {
      ...agentDataBase,
      memory_ids_used: 'mem_1',
      memory_ids_rejected: 'mem_1',
    });
    expect(result.failures).toContain('memory_ids_overlap');
  });

  it('produces failure memory_ids_unaccounted when injected IDs are neither used nor rejected', () => {
    const logs = ackBlock(['mem_1', 'mem_2']);
    const result = validateMemoryReporting(logs, ctx('mem_1', 'mem_2'), {
      ...agentDataBase,
      memory_ids_used: 'mem_1',
      memory_ids_rejected: '',
    });
    expect(result.failures).toContain('memory_ids_unaccounted');
  });

  it('hard-fails memory_acknowledgment when triplet is broken AND ack block is missing', () => {
    const result = validateMemoryReporting('no ack block here', ctx('mem_1'), {
      ...agentDataBase,
      memory_usage_summary: '',
      memory_ids_used: 'mem_1',
      memory_ids_rejected: '',
    });
    expect(result.failures).toContain('memory_acknowledgment');
    expect(result.softWarnings).toEqual([]);
  });

  it('soft-warns memory_acknowledgment when triplet is consistent but ack block is missing', () => {
    const result = validateMemoryReporting('no ack block', ctx('mem_1'), {
      ...agentDataBase,
      memory_ids_used: 'mem_1',
      memory_ids_rejected: '',
    });
    expect(result.failures).toEqual([]);
    expect(result.softWarnings).toEqual(['memory_acknowledgment']);
  });

  it('returns clean result when ack block present and triplet consistent', () => {
    const logs = ackBlock(['mem_1']);
    const result = validateMemoryReporting(logs, ctx('mem_1'), {
      ...agentDataBase,
      memory_ids_used: 'mem_1',
      memory_ids_rejected: '',
    });
    expect(result).toEqual({ failures: [], softWarnings: [] });
  });
});

// [INT-1461] Telemetry-field taxonomy helpers.
describe('isTelemetryField', () => {
  it('returns true for memory-acknowledgment field names', () => {
    expect(isTelemetryField('memory_acknowledgment')).toBe(true);
    expect(isTelemetryField('memory_ids_used')).toBe(true);
    expect(isTelemetryField('memory_ids_used_invalid')).toBe(true);
    expect(isTelemetryField('memory_ids_rejected')).toBe(true);
    expect(isTelemetryField('memory_ids_rejected_invalid')).toBe(true);
    expect(isTelemetryField('memory_ids_overlap')).toBe(true);
    expect(isTelemetryField('memory_ids_unaccounted')).toBe(true);
    expect(isTelemetryField('memory_usage_summary')).toBe(true);
  });

  it('returns false for deliverable field names', () => {
    expect(isTelemetryField('gh_pr_url')).toBe(false);
    expect(isTelemetryField('review_comments_posted')).toBe(false);
    expect(isTelemetryField('review_types')).toBe(false);
    expect(isTelemetryField('tracking_comment_id')).toBe(false);
    expect(isTelemetryField('pr_url')).toBe(false);
    expect(isTelemetryField('summary')).toBe(false);
    expect(isTelemetryField('linear_url')).toBe(false);
    expect(isTelemetryField('outcome')).toBe(false);
    expect(isTelemetryField('fatal_exit_code_137')).toBe(false);
    expect(isTelemetryField('fatal_exit_code_139')).toBe(false);
    expect(isTelemetryField('transcript_too_short')).toBe(false);
  });
});

describe('partitionMissingFields', () => {
  it('splits a mixed list correctly', () => {
    const result = partitionMissingFields([
      'gh_pr_url',
      'memory_acknowledgment',
      'review_comments_posted',
      'memory_ids_unaccounted',
    ]);
    expect(result.blocking).toEqual(['gh_pr_url', 'review_comments_posted']);
    expect(result.telemetry).toEqual(['memory_acknowledgment', 'memory_ids_unaccounted']);
  });

  it('returns empty arrays for empty input', () => {
    const result = partitionMissingFields([]);
    expect(result.blocking).toEqual([]);
    expect(result.telemetry).toEqual([]);
  });
});
