import { describe, it, expect } from 'vitest';
import { buildResearchContextRepairPrompt } from '../repairPrompt.js';

describe('buildResearchContextRepairPrompt', () => {
  it('should include outdoor_recreation and fishing in domain list', () => {
    const result = buildResearchContextRepairPrompt('test query', '{}', 'validation error');
    expect(result).toContain('outdoor_recreation');
    expect(result).toContain('fishing');
  });

  it('should include user_exclusions in safety schema', () => {
    const result = buildResearchContextRepairPrompt('test query', '{}', 'validation error');
    expect(result).toContain('user_exclusions');
  });
});
