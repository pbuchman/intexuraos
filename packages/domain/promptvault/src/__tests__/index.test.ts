import { describe, it, expect } from 'vitest';

describe('@praxos/domain-promptvault', () => {
  it('package is importable', async () => {
    const module = await import('../index.js');
    expect(module).toBeDefined();
  });
});
