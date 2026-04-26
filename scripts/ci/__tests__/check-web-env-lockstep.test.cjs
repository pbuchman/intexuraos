'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, '../check-web-env-lockstep.cjs');

describe('check-web-env-lockstep', () => {
  test('passes when cloudbuild and config.ts agree', () => {
    const out = execFileSync('node', [SCRIPT], { encoding: 'utf-8' });
    expect(out).toMatch(/lockstep OK/);
  });
});
