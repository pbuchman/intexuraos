/**
 * Tests for review type constants.
 */

import { describe, it, expect } from 'vitest';
import { ALL_REVIEW_TYPES, LLM_TOOL_REVIEW_TYPES } from '../../../domain/constants/reviewTypes.js';

describe('ALL_REVIEW_TYPES', () => {
  it('includes test_quality', () => {
    expect(ALL_REVIEW_TYPES).toContain('test_quality');
  });

  it('includes documentation', () => {
    expect(ALL_REVIEW_TYPES).toContain('documentation');
  });

  it('includes all expected review types', () => {
    expect([...ALL_REVIEW_TYPES]).toEqual(
      expect.arrayContaining(['code_quality', 'security', 'architecture', 'plan_review', 'test_quality', 'documentation']),
    );
  });
});

describe('LLM_TOOL_REVIEW_TYPES', () => {
  it('includes test_quality', () => {
    expect(LLM_TOOL_REVIEW_TYPES).toContain('test_quality');
  });

  it('includes documentation', () => {
    expect(LLM_TOOL_REVIEW_TYPES).toContain('documentation');
  });

  it('excludes plan_review', () => {
    expect(LLM_TOOL_REVIEW_TYPES).not.toContain('plan_review');
  });

  it('includes code_quality, security, architecture, test_quality, and documentation', () => {
    expect([...LLM_TOOL_REVIEW_TYPES]).toEqual(
      expect.arrayContaining(['code_quality', 'security', 'architecture', 'test_quality', 'documentation']),
    );
  });
});
