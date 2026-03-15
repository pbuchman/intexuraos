/**
 * Tests for triage validation schemas and repair message builder.
 */

import { describe, it, expect } from 'vitest';
import {
  TriageSkipSchema,
  TriageReviewSchema,
  TriageResultSchema,
} from '../../../domain/validation/triageSchema.js';
import { buildTriageRepairMessage } from '../../../domain/validation/buildTriageRepairMessage.js';

describe('TriageSkipSchema', () => {
  it('accepts a valid skip with a non-empty reason', () => {
    const result = TriageSkipSchema.safeParse({ action: 'skip', reason: 'PR only changes docs' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty reason', () => {
    const result = TriageSkipSchema.safeParse({ action: 'skip', reason: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing reason', () => {
    const result = TriageSkipSchema.safeParse({ action: 'skip' });
    expect(result.success).toBe(false);
  });
});

describe('TriageReviewSchema', () => {
  it('accepts a valid review with known review types', () => {
    const result = TriageReviewSchema.safeParse({
      action: 'request_review',
      reviewTypes: ['code_quality', 'security'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown review type', () => {
    const result = TriageReviewSchema.safeParse({
      action: 'request_review',
      reviewTypes: ['unknown_type'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty reviewTypes array', () => {
    const result = TriageReviewSchema.safeParse({
      action: 'request_review',
      reviewTypes: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing reviewTypes', () => {
    const result = TriageReviewSchema.safeParse({
      action: 'request_review',
    });
    expect(result.success).toBe(false);
  });
});

describe('TriageResultSchema', () => {
  it('accepts a valid skip result', () => {
    const result = TriageResultSchema.safeParse({ action: 'skip', reason: 'Not relevant' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid review result', () => {
    const result = TriageResultSchema.safeParse({
      action: 'request_review',
      reviewTypes: ['architecture'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing action', () => {
    const result = TriageResultSchema.safeParse({ reason: 'No action' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown action', () => {
    const result = TriageResultSchema.safeParse({ action: 'unknown', reason: 'bad' });
    expect(result.success).toBe(false);
  });
});

describe('buildTriageRepairMessage', () => {
  it('tells LLM tools were recorded when reviews already requested', () => {
    const state = { skipped: false, skipReason: undefined, reviewsRequested: ['code_quality'] };
    const message = buildTriageRepairMessage(state);
    expect(message).toContain('recorded successfully');
    expect(message).toContain('Do NOT call any more tools');
    expect(message).toContain(JSON.stringify(state));
    expect(message).not.toContain('incomplete');
  });

  it('tells LLM to call a tool when no tools were called', () => {
    const state = { skipped: false, skipReason: undefined, reviewsRequested: [] };
    const message = buildTriageRepairMessage(state);
    expect(message).toContain('incomplete');
    expect(message).toContain('skip(reason)');
    expect(message).toContain('request_review(review_type)');
    expect(message).toContain(JSON.stringify(state));
    expect(message).not.toContain('recorded successfully');
  });

  it('tells LLM tools were recorded when skip was called', () => {
    const state = { skipped: true, skipReason: 'Docs only', reviewsRequested: [] };
    const message = buildTriageRepairMessage(state);
    expect(message).toContain('recorded successfully');
    expect(message).toContain('Do NOT call any more tools');
    expect(message).not.toContain('incomplete');
  });
});
