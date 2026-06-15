import { describe, expect, it } from 'vitest';
import { buildMockClaudeHealth } from '../../e2e/mock-claude/health.js';

describe('E2E mock Claude health contract', () => {
  it('returns the worker capability details required by code-agent dispatch checks', () => {
    expect(buildMockClaudeHealth(1)).toEqual({
      status: 'ready',
      capacity: 3,
      running: 1,
      available: 2,
      workerAuths: {
        claude: { status: 'active', authMode: 'mock', refreshSupported: false },
        codex: { status: 'not_configured', refreshSupported: false },
      },
      providerApiKeys: {},
      dockerHealthy: true,
      diskHealthy: true,
    });
  });
});
