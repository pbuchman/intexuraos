'use strict';
/**
 * Web bundle-budget guard. Runs after the web app build completes.
 * Fails (exit 1) if any .js chunk in dist/assets exceeds the budget.
 *
 * Why a separate script (not the vitest spec): vitest runs in CI BEFORE the
 * build phase, so the in-test guard is effectively dormant. This script runs
 * post-build in scripts/ci.mjs so the guard actually fires.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const DIST_ASSETS = path.join(REPO_ROOT, 'apps/web/dist/assets');
const BUDGET_BYTES = 1.5 * 1024 * 1024;

function main() {
  if (!fs.existsSync(DIST_ASSETS)) {
    console.error(`Bundle budget: ${DIST_ASSETS} not found — did the web build run?`);
    process.exit(1);
  }
  const tooLarge = fs
    .readdirSync(DIST_ASSETS)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ name: f, size: fs.statSync(path.join(DIST_ASSETS, f)).size }))
    .filter((entry) => entry.size > BUDGET_BYTES);

  if (tooLarge.length > 0) {
    console.error('Web bundle budget exceeded (limit 1.5 MB uncompressed):');
    for (const entry of tooLarge) {
      const mb = (entry.size / (1024 * 1024)).toFixed(2);
      console.error(`  - ${entry.name}: ${mb} MB`);
    }
    process.exit(1);
  }
  console.log('Web bundle budget OK');
}

main();
