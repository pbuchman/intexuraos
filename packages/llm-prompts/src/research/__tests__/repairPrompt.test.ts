import { describe, it, expect } from 'vitest';
import { researchContextRepairPrompt } from '../repairPrompt.js';

describe('researchContextRepairPrompt', () => {
  it('has correct metadata', () => {
    expect(researchContextRepairPrompt.name).toBe('research-context-repair');
    expect(researchContextRepairPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should include outdoor_recreation and fishing in domain list', () => {
    const result = researchContextRepairPrompt.build({
      originalQuery: 'test query',
      invalidResponse: '{}',
      errorMessage: 'validation error',
    });
    expect(result).toContain('outdoor_recreation');
    expect(result).toContain('fishing');
    expect(result).toContain('construction_building');
  });

  it('should include user_exclusions in safety schema', () => {
    const result = researchContextRepairPrompt.build({
      originalQuery: 'test query',
      invalidResponse: '{}',
      errorMessage: 'validation error',
    });
    expect(result).toContain('user_exclusions');
  });
});
