import { describe, expect, it } from 'vitest';
import { normalizeScheduleAction } from '../types.js';

describe('normalizeScheduleAction', () => {
  it('defaults missing preferredTools to an empty list', () => {
    const action = normalizeScheduleAction({
      services: ['code-agent', 'code-agent'],
      instruction: 'run cleanup',
    });

    expect(action).toEqual({
      services: ['code-agent'],
      instruction: 'run cleanup',
      preferredTools: [],
    });
  });
});
