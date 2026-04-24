import { describe, expect, it } from 'vitest';
import type {
  ExecutionMemoryPromptContext,
  ExecutionMemoryPromptMemory,
} from '../../../types/execution-memory.js';
import {
  detectEmptyMemoryFields,
  isTelemetryField,
  partitionMissingFields,
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

describe('detectEmptyMemoryFields (post-INT-1470: reads coerced arrays, not raw strings)', () => {
  it('returns undefined when no memories were injected', () => {
    expect(
      detectEmptyMemoryFields('execution', undefined, {
        memory_ids_used: [],
        memory_ids_rejected: [],
      })
    ).toBeUndefined();
    expect(detectEmptyMemoryFields('execution', ctx(), {})).toBeUndefined();
  });

  it('returns the two field names when memories injected but neither field populated', () => {
    expect(
      detectEmptyMemoryFields('execution', ctx('mem_a'), {
        memory_ids_used: [],
        memory_ids_rejected: [],
      })
    ).toEqual(['memory_ids_used', 'memory_ids_rejected']);
  });

  it('returns undefined when memory_ids_used is populated', () => {
    expect(
      detectEmptyMemoryFields('execution', ctx('mem_a'), {
        memory_ids_used: ['mem_a'],
        memory_ids_rejected: [],
      })
    ).toBeUndefined();
  });

  it('returns undefined when memory_ids_rejected is populated', () => {
    expect(
      detectEmptyMemoryFields('planning', ctx('mem_a'), {
        memory_ids_used: [],
        memory_ids_rejected: ['mem_a'],
      })
    ).toBeUndefined();
  });

  it('tolerates missing keys on data record (treats as empty)', () => {
    expect(detectEmptyMemoryFields('execution', ctx('mem_a'), {})).toEqual([
      'memory_ids_used',
      'memory_ids_rejected',
    ]);
  });

  it('tolerates non-array values on data record (treats as empty)', () => {
    expect(
      detectEmptyMemoryFields('execution', ctx('mem_a'), {
        memory_ids_used: 'not-an-array',
        memory_ids_rejected: 42,
      })
    ).toEqual(['memory_ids_used', 'memory_ids_rejected']);
  });
});

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
