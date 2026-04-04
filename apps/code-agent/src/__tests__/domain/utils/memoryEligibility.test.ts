import { describe, it, expect } from 'vitest';
import { isMemoryEligibleAgent } from '../../../domain/utils/memoryEligibility.js';

describe('isMemoryEligibleAgent', () => {
  it('returns true for execution', () => {
    expect(isMemoryEligibleAgent('execution')).toBe(true);
  });

  it('returns true for planning', () => {
    expect(isMemoryEligibleAgent('planning')).toBe(true);
  });

  it('returns true for review', () => {
    expect(isMemoryEligibleAgent('review')).toBe(true);
  });

  it('returns false for pull_request', () => {
    expect(isMemoryEligibleAgent('pull_request')).toBe(false);
  });

  it('returns false for remediation', () => {
    expect(isMemoryEligibleAgent('remediation')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isMemoryEligibleAgent(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isMemoryEligibleAgent('')).toBe(false);
  });
});
