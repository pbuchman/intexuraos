import { describe, it, expect } from 'vitest';
import { extractDispatchWorkerType } from '../../../domain/utils/dispatchWorkerTriage.js';

describe('extractDispatchWorkerType', () => {
  it('rejects a retired worker type', () => {
    expect(extractDispatchWorkerType('Fix this @worker minimax')).toBeUndefined();
  });

  it('should return undefined for @model directive (removed)', () => {
    expect(extractDispatchWorkerType('@model qwen fix tests')).toBeUndefined();
    expect(extractDispatchWorkerType('@model opus')).toBeUndefined();
    expect(extractDispatchWorkerType('fix this @model sonnet')).toBeUndefined();
  });

  it('rejects a retired qwen worker type', () => {
    expect(extractDispatchWorkerType('@worker qwen')).toBeUndefined();
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

  it('uses @worker when both @worker and @model present', () => {
    // @model is ignored, so @worker opus is used
    expect(extractDispatchWorkerType('@worker opus @model sonnet')).toBe('opus');
  });

  it('extracts opus from @worker opus', () => {
    expect(extractDispatchWorkerType('@worker opus')).toBe('opus');
  });
  it('rejects a retired glm worker type', () => {
    expect(extractDispatchWorkerType('@worker glm')).toBeUndefined();
  });

  it('rejects a retired kimi worker type', () => {
    expect(extractDispatchWorkerType('@worker kimi')).toBeUndefined();
  });

  it('extracts codex from @worker codex', () => {
    expect(extractDispatchWorkerType('@worker codex')).toBe('codex');
  });

  it('extracts codex-xhigh from @worker codex-xhigh', () => {
    expect(extractDispatchWorkerType('@worker codex-xhigh')).toBe('codex-xhigh');
  });

  it('extracts openrouter-free from @worker openrouter-free', () => {
    expect(extractDispatchWorkerType('@worker openrouter-free')).toBe('openrouter-free');
  });

  it('rejects qwen3.5-plus explicit form', () => {
    expect(extractDispatchWorkerType('@worker qwen3.5-plus')).toBeUndefined();
  });

  it('returns undefined for @worker without type', () => {
    expect(extractDispatchWorkerType('@worker')).toBeUndefined();
  });
});
