/**
 * Tests for reviewTriage utility functions.
 */

import { describe, it, expect } from 'vitest';
import { extractReviewWorkerType, isReviewCommandComment, normalizeReviewWorkerType } from '../../../domain/utils/reviewTriage.js';

describe('extractReviewWorkerType', () => {
  it('extracts worker type from @review with minimax', () => {
    const workerType = extractReviewWorkerType('@review with minimax');
    expect(workerType).toBe('minimax');
  });

  it('extracts worker type from @review architecture security qwen', () => {
    const workerType = extractReviewWorkerType('@review architecture security qwen');
    expect(workerType).toBe('qwen3.5-plus');
  });

  it('returns undefined when no worker type found', () => {
    const workerType = extractReviewWorkerType('@review architecture');
    expect(workerType).toBeUndefined();
  });

  it('returns undefined for unknown worker names', () => {
    const workerType = extractReviewWorkerType('@review with unknown-model');
    expect(workerType).toBeUndefined();
  });

  it('extracts opus worker type', () => {
    const workerType = extractReviewWorkerType('@review opus');
    expect(workerType).toBe('opus');
  });

  it('extracts sonnet worker type', () => {
    const workerType = extractReviewWorkerType('@review with sonnet please');
    expect(workerType).toBe('sonnet');
  });

  it('extracts glm worker type', () => {
    const workerType = extractReviewWorkerType('@review glm');
    expect(workerType).toBe('glm');
  });

  it('extracts auto worker type', () => {
    const workerType = extractReviewWorkerType('@review auto');
    expect(workerType).toBe('auto');
  });

  it('is case-insensitive', () => {
    const workerType = extractReviewWorkerType('@review with MINIMAX');
    expect(workerType).toBe('minimax');
  });

  it('returns first recognized worker when multiple tokens present', () => {
    const workerType = extractReviewWorkerType('@review with opus and sonnet');
    expect(workerType).toBe('opus');
  });
});

describe('isReviewCommandComment', () => {
  it('returns true for @review at start', () => {
    expect(isReviewCommandComment('@review')).toBe(true);
  });

  it('returns true for @review with leading whitespace', () => {
    expect(isReviewCommandComment('  @review')).toBe(true);
  });

  it('returns true for @review followed by space', () => {
    expect(isReviewCommandComment('@review code_quality')).toBe(true);
  });

  it('returns false for @reviewx (not a word boundary)', () => {
    expect(isReviewCommandComment('@reviewx')).toBe(false);
  });

  it('returns false for text before @review', () => {
    expect(isReviewCommandComment('please @review')).toBe(false);
  });
});

describe('normalizeReviewWorkerType', () => {
  it('normalizes qwen to qwen3.5-plus', () => {
    expect(normalizeReviewWorkerType('qwen')).toBe('qwen3.5-plus');
  });

  it('normalizes case-insensitively', () => {
    expect(normalizeReviewWorkerType('MINIMAX')).toBe('minimax');
  });

  it('returns undefined for unknown type', () => {
    expect(normalizeReviewWorkerType('unknown')).toBeUndefined();
  });

  it('trims whitespace', () => {
    expect(normalizeReviewWorkerType('  opus  ')).toBe('opus');
  });
});