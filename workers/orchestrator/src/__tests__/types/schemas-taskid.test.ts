import { describe, expect, it } from 'vitest';
import { CreateTaskRequestSchema } from '../../types/schemas.js';

const baseRequest = {
  workerType: 'opus',
  prompt: 'do work',
  webhookUrl: 'https://example.com/hook',
  webhookSecret: 'secret',
} as const;

describe('CreateTaskRequestSchema.taskId', () => {
  const valid = 'task_0ba004f8-253e-4110-be10-9856b959d3f1';

  it('accepts a canonical task UUID', () => {
    const result = CreateTaskRequestSchema.safeParse({ ...baseRequest, taskId: valid });
    expect(result.success).toBe(true);
  });

  it('accepts deterministic task ids emitted by code-agent reservation flows', () => {
    const deterministicTaskIds = [
      'task_review_3575a69848b633cd68c25a0688a6c6d1',
      'task_github_0123456789abcdef0123456789abcdef01234567',
    ];

    for (const taskId of deterministicTaskIds) {
      const result = CreateTaskRequestSchema.safeParse({ ...baseRequest, taskId });
      expect(result.success).toBe(true);
    }
  });

  it('rejects empty string', () => {
    const result = CreateTaskRequestSchema.safeParse({ ...baseRequest, taskId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing task_ prefix', () => {
    const result = CreateTaskRequestSchema.safeParse({
      ...baseRequest,
      taskId: '0ba004f8-253e-4110-be10-9856b959d3f1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects wrong-length UUID', () => {
    const result = CreateTaskRequestSchema.safeParse({ ...baseRequest, taskId: 'task_deadbeef' });
    expect(result.success).toBe(false);
  });

  it('rejects shell metacharacters', () => {
    const result = CreateTaskRequestSchema.safeParse({
      ...baseRequest,
      taskId: 'task_0ba004f8-253e-4110-be10-9856b959d3f1; rm -rf /',
    });
    expect(result.success).toBe(false);
  });

  it('rejects backtick injection', () => {
    const result = CreateTaskRequestSchema.safeParse({
      ...baseRequest,
      taskId: 'task_`id`-253e-4110-be10-9856b959d3f1',
    });
    expect(result.success).toBe(false);
  });

  it('accepts uppercase hex (canonical Linear shape is lowercase, be permissive on case but strict on charset)', () => {
    const result = CreateTaskRequestSchema.safeParse({
      ...baseRequest,
      taskId: 'task_0BA004F8-253E-4110-BE10-9856B959D3F1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects 36 hex chars without dashes (not canonical UUID shape)', () => {
    const result = CreateTaskRequestSchema.safeParse({
      ...baseRequest,
      taskId: 'task_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(result.success).toBe(false);
  });

  it('rejects 36 dashes (not canonical UUID shape)', () => {
    const result = CreateTaskRequestSchema.safeParse({
      ...baseRequest,
      taskId: 'task_------------------------------------',
    });
    expect(result.success).toBe(false);
  });
});
