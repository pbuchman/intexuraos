#!/usr/bin/env node
/**
 * Find files with lowest coverage from coverage-summary.json
 */

import fs from 'node:fs';
import path from 'node:path';

const data = JSON.parse(fs.readFileSync('coverage/coverage-summary.json', 'utf8'));

const results = Object.entries(data)
  .filter(([key]) => key !== 'total')
  .map(([filePath, metrics]) => {
    // Extract package from absolute path like /Users/.../apps/actions-agent/src/...
    const match = filePath.match(/\/(apps|packages|workers)\/([^/]+)\//);
    const pkg = match ? match[1] + '/' + match[2] : 'other';
    const filename = filePath.split('/').pop() || 'unknown';
    return {
      filename,
      pkg,
      branch: metrics.branches?.pct || 0,
      lines: metrics.lines?.pct || 0,
      functions: metrics.functions?.pct || 0,
      statements: metrics.statements?.pct || 0,
    };
  })
  .sort((a, b) => a.branch - b.branch)
  .slice(0, 5);

console.log('\n5 files with lowest branch coverage:\n');
results.forEach((r, i) => {
  console.log(`${i + 1}. ${r.pkg}/${r.filename} - branch: ${r.branch.toFixed(2)}%, lines: ${r.lines.toFixed(2)}%`);
});
