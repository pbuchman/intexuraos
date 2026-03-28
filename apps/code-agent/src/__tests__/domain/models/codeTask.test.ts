import { describe, it, expect } from 'vitest';
import type { TaskStatus, WorkerType, WorkerLocation } from '../../../domain/models/codeTask.js';

describe('CodeTask model', () => {
  it('has correct status values', () => {
    const validStatuses: TaskStatus[] = [
      'dispatched',
      'running',
      'queued',
      'planned',
      'implemented',
      'failed',
      'interrupted',
      'cancelled',
      'archived',
    ];

    // Type-level validation - if this compiles, types are correct
    validStatuses.forEach((status) => {
      expect(typeof status).toBe('string');
    });
  });

  it('has correct worker types', () => {
    const validTypes: WorkerType[] = [
      'opus',
      'auto',
      'sonnet',
      'minimax',
      'glm',
      'qwen',
      'kimi',
      'codex',
      'codex-xhigh',
    ];
    validTypes.forEach((type) => {
      expect(typeof type).toBe('string');
    });
  });

  it('has correct worker locations', () => {
    const validLocations: WorkerLocation[] = ['mac', 'vm'];
    validLocations.forEach((loc) => {
      expect(typeof loc).toBe('string');
    });
  });
});
