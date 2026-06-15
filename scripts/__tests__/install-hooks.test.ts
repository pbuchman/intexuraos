import { describe, expect, it } from 'vitest';

import { buildHookFiles } from '../install-hooks.mjs'; // @allow-missing-js -- .mjs import

describe('buildHookFiles', () => {
  it('installs both the protected pre-commit hook and the firestore pre-push checks', () => {
    const hooks = buildHookFiles();

    expect(hooks).toHaveProperty('pre-commit');
    expect(hooks).toHaveProperty('pre-push');
    expect(hooks['pre-commit']).toContain('vitest.config.ts');
    expect(hooks['pre-push']).toContain('pnpm verify:migrations');
    expect(hooks['pre-push']).toContain('pnpm verify:firestore-artifacts');
  });
});
