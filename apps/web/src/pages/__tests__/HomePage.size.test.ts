// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('HomePage.tsx size budget', () => {
  it('is ≤ 200 LOC', () => {
    const src = readFileSync(resolve(__dirname, '../HomePage.tsx'), 'utf-8');
    const loc = src.split('\n').length;
    expect(loc).toBeLessThanOrEqual(200);
  });
});
