import { describe, expect, it } from 'vitest';
import { resolveCompletedTaskStatus } from '../../../domain/utils/resolveCompletedTaskStatus.js';

describe('resolveCompletedTaskStatus', () => {
  it.each([
    ['planning', 'planned'],
    ['review', 'reviewed'],
    ['execution', 'implemented'],
    ['remediation', 'implemented'],
    ['pull_request', 'implemented'],
  ] as const)('maps %s to %s', (agentType, expectedStatus) => {
    expect(resolveCompletedTaskStatus(agentType)).toBe(expectedStatus);
  });
});
