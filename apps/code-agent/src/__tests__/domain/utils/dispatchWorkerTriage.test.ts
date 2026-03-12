import { describe, it, expect } from 'vitest';
import { extractDispatchWorkerType } from '../../../domain/utils/dispatchWorkerTriage.js';

describe('extractDispatchWorkerType', () => {
  it('extracts worker type from @worker directive', () => {
    expect(extractDispatchWorkerType('Fix this @worker minimax')).toBe('minimax');
  });

  it('extracts worker type from @model directive', () => {
    expect(extractDispatchWorkerType('@model qwen fix tests')).toBe('qwen');
  });

  it('normalizes qwen alias to qwen', () => {
    expect(extractDispatchWorkerType('@worker qwen')).toBe('qwen');
  });

  it('returns undefined when no directive found', () => {
    expect(extractDispatchWorkerType('Fix the bug')).toBeUndefined();
  });

  it('returns undefined for unknown worker type', () => {
    expect(extractDispatchWorkerType('@worker unknown')).toBeUndefined();
  });

  it('is case-insensitive', () => {
    expect(extractDispatchWorkerType('@WORKER OPUS')).toBe('opus');
  });

  it('uses first match when multiple directives', () => {
    expect(extractDispatchWorkerType('@worker opus @model sonnet')).toBe('opus');
  });

  it('extracts opus from @worker opus', () => {
    expect(extractDispatchWorkerType('@worker opus')).toBe('opus');
  });

  it('extracts sonnet from @model sonnet', () => {
    expect(extractDispatchWorkerType('@model sonnet')).toBe('sonnet');
  });

  it('normalizes glm to glm', () => {
    expect(extractDispatchWorkerType('@worker glm')).toBe('glm');
  });

  it('extracts auto from @model auto', () => {
    expect(extractDispatchWorkerType('@model auto')).toBe('auto');
  });

  it('rejects qwen3.5-plus explicit form', () => {
    expect(extractDispatchWorkerType('@worker qwen3.5-plus')).toBeUndefined();
  });

  it('returns undefined for @worker without type', () => {
    expect(extractDispatchWorkerType('@worker')).toBeUndefined();
  });

  it('returns undefined for @model without type', () => {
    expect(extractDispatchWorkerType('@model')).toBeUndefined();
  });
});
