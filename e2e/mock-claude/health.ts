export interface MockClaudeHealth {
  status: 'ready';
  capacity: number;
  running: number;
  available: number;
  workerAuths: {
    claude: { status: 'active'; authMode: 'mock'; refreshSupported: false };
    codex: { status: 'not_configured'; refreshSupported: false };
  };
  providerApiKeys: Record<string, { configured: boolean }>;
  dockerHealthy: boolean;
  diskHealthy: boolean;
}

export function buildMockClaudeHealth(running: number): MockClaudeHealth {
  const capacity = 3;

  return {
    status: 'ready',
    capacity,
    running,
    available: capacity - running,
    workerAuths: {
      claude: { status: 'active', authMode: 'mock', refreshSupported: false },
      codex: { status: 'not_configured', refreshSupported: false },
    },
    providerApiKeys: {},
    dockerHealthy: true,
    diskHealthy: true,
  };
}
