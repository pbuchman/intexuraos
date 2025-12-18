import { describe, it, expect } from 'vitest';

describe('@praxos/infra-auth0', () => {
  it('package is importable', async () => {
    const module = await import('../index.js');
    expect(module).toBeDefined();
  });
});
