import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = readFileSync(new URL('../verify-workspace.sh', import.meta.url), 'utf8');

describe('verify-workspace.sh', () => {
  it('runs Web tests inside the Web workspace instead of the repository root', () => {
    expect(script).toContain('pnpm --filter @intexuraos/$WORKSPACE test');
    expect(script).not.toContain('pnpm run test -- $SERVICE_DIR');
  });
});
