import { describe, it, expect } from 'vitest';
import type { TaskStatus, WorkerType, WorkerLocation } from '../../../domain/models/codeTask.js';

describe('CodeTask model', () => {
  it('has correct status values', () => {
    const validStatuses: TaskStatus[] = [
      'dispatched',
      'running',
      'completed',
      'failed',
      'interrupted',
      'cancelled',
    ];

    // Type-level validation - if this compiles, types are correct
    validStatuses.forEach((status) => {
      expect(typeof status).toBe('string');
    });
  });

  it('has correct worker types', () => {
    const validTypes: WorkerType[] = ['opus', 'auto', 'glm'];
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
