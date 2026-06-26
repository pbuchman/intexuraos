import { describe, expect, it } from 'vitest';

const EXPECTED_CODE_TASK_REVIEW_TYPES = [
  'code_quality',
  'security',
  'architecture',
  'plan_review',
  'test_quality',
  'documentation',
];

describe('code task review types', () => {
  it('exports the canonical review type list from the package root', async () => {
    const codeTaskDomain = (await import('../index.js')) as Record<string, unknown>;

    expect(codeTaskDomain['CODE_TASK_REVIEW_TYPES']).toEqual(EXPECTED_CODE_TASK_REVIEW_TYPES);
  });

  it('exports LLM triage review types without plan_review', async () => {
    const codeTaskDomain = (await import('../index.js')) as Record<string, unknown>;

    expect(codeTaskDomain['LLM_TRIAGE_REVIEW_TYPES']).toEqual([
      'code_quality',
      'security',
      'architecture',
      'test_quality',
      'documentation',
    ]);
  });

  it('exports a runtime review type guard that recognizes documentation', async () => {
    const codeTaskDomain = (await import('../index.js')) as Record<string, unknown>;
    const guard = codeTaskDomain['isCodeTaskReviewType'];

    expect(typeof guard).toBe('function');

    if (typeof guard !== 'function') {
      return;
    }

    for (const reviewType of EXPECTED_CODE_TASK_REVIEW_TYPES) {
      expect(guard(reviewType)).toBe(true);
    }

    expect(guard('requirements')).toBe(false);
  });
});
