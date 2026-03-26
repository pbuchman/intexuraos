import { describe, it, expect } from 'vitest';
import { REVIEW_SCHEMA, buildReviewPrompt } from '../services/completion-verifier.js';

describe('REVIEW_SCHEMA', () => {
  it('validates needs_remediation as "0"', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1',
      review_comments_posted: '3',
      review_types: 'code_quality',
      summary: 'All good.',
      needs_remediation: '0',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.needs_remediation).toBe('0');
    }
  });

  it('validates needs_remediation as "1"', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1',
      review_comments_posted: '2',
      review_types: 'security',
      summary: 'Found issues.',
      needs_remediation: '1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.needs_remediation).toBe('1');
    }
  });

  it('defaults needs_remediation to "1" when omitted', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1',
      review_comments_posted: '0',
      review_types: 'code_quality',
      summary: 'No findings.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.needs_remediation).toBe('1');
    }
  });

  it('rejects needs_remediation value other than "0" or "1"', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1',
      review_comments_posted: '1',
      review_types: 'code_quality',
      summary: 'Some findings.',
      needs_remediation: '2',
    });
    expect(result.success).toBe(false);
  });

  it('rejects needs_remediation as non-numeric string', () => {
    const result = REVIEW_SCHEMA.safeParse({
      gh_pr_url: 'https://github.com/pbuchman/intexuraos/pull/1',
      review_comments_posted: '1',
      review_types: 'code_quality',
      summary: 'Some findings.',
      needs_remediation: 'yes',
    });
    expect(result.success).toBe(false);
  });
});

describe('buildReviewPrompt', () => {
  it('includes needs_remediation in the Fields list', () => {
    const prompt = buildReviewPrompt('some transcript');
    expect(prompt).toContain('needs_remediation');
  });

  it('includes needs_remediation in the example JSON response', () => {
    const prompt = buildReviewPrompt('some transcript');
    // The example JSON should contain the field as a key
    expect(prompt).toMatch(/"needs_remediation"/);
  });
});
