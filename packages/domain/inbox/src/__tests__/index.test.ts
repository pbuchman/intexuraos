/**
 * Tests for @praxos/domain-inbox package exports.
 */
import { describe, it, expect } from 'vitest';

describe('@praxos/domain-inbox', () => {
  it('package is importable', async (): Promise<void> => {
    const pkg = await import('../index.js');
    expect(pkg).toBeDefined();
  });
});
