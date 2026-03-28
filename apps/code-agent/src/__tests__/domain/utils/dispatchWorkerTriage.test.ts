import { describe, it, expect } from 'vitest';
import { extractDispatchWorkerType } from '../../../domain/utils/dispatchWorkerTriage.js';

describe('extractDispatchWorkerType', () => {
  it('extracts worker type from @worker directive', () => {
    expect(extractDispatchWorkerType('Fix this @worker minimax')).toBe('minimax');
  });

  it('should return undefined for @model directive (removed)', () => {
    expect(extractDispatchWorkerType('@model qwen fix tests')).toBeUndefined();
    expect(extractDispatchWorkerType('@model opus')).toBeUndefined();
    expect(extractDispatchWorkerType('fix this @model sonnet')).toBeUndefined();
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

  it('uses @worker when both @worker and @model present', () => {
    // @model is ignored, so @worker opus is used
    expect(extractDispatchWorkerType('@worker opus @model sonnet')).toBe('opus');
  });

  it('extracts opus from @worker opus', () => {
    expect(extractDispatchWorkerType('@worker opus')).toBe('opus');
  });


  it('normalizes glm to glm', () => {
    expect(extractDispatchWorkerType('@worker glm')).toBe('glm');
  });

  it('extracts kimi from @worker kimi', () => {
    expect(extractDispatchWorkerType('@worker kimi')).toBe('kimi');
  });

  it('extracts codex from @worker codex', () => {
    expect(extractDispatchWorkerType('@worker codex')).toBe('codex');
  });

  it('extracts codex-xhigh from @worker codex-xhigh', () => {
    expect(extractDispatchWorkerType('@worker codex-xhigh')).toBe('codex-xhigh');
  });

  it('rejects qwen3.5-plus explicit form', () => {
    expect(extractDispatchWorkerType('@worker qwen3.5-plus')).toBeUndefined();
  });

  it('returns undefined for @worker without type', () => {
    expect(extractDispatchWorkerType('@worker')).toBeUndefined();
  });

});
