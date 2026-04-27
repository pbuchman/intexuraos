/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('InboxPage.tsx size budget', () => {
  it('is <= 200 LOC', () => {
    const src = readFileSync(resolve(__dirname, '../InboxPage.tsx'), 'utf-8');
    const loc = src.split('\n').length;
    expect(loc).toBeLessThanOrEqual(200);
  });
});
