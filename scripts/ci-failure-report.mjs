#!/usr/bin/env node
/**
 * CI Failure Report Generator
 *
 * Aggregates failures from all branch files in .claude/ci-failures/
 * Focuses on first-run failures (runNumber: 1) to identify patterns
 * LLMs generate that need to be addressed in coding instructions.
 *
 * Usage:
 *   node scripts/ci-failure-report.mjs              # Full report
 *   node scripts/ci-failure-report.mjs --first-run  # First-run failures only
 *   node scripts/ci-failure-report.mjs --json       # JSON output
 *   node scripts/ci-failure-report.mjs --days 7     # Last 7 days only
 */

import { resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const repoRoot = resolve(import.meta.dirname, '..');
const failuresDir = resolve(repoRoot, '.claude/ci-failures');

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    firstRunOnly: args.includes('--first-run'),
    jsonOutput: args.includes('--json'),
    days: (() => {
      const idx = args.indexOf('--days');
      if (idx !== -1 && args[idx + 1]) {
        return parseInt(args[idx + 1], 10);
      }
      return 30;
    })(),
  };
}

function loadAllRuns(daysLimit) {
  if (!existsSync(failuresDir)) {
    return [];
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysLimit);

  const runs = [];
  const files = readdirSync(failuresDir).filter((f) => f.endsWith('.jsonl'));

  for (const file of files) {
    const content = readFileSync(resolve(failuresDir, file), 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const entryDate = new Date(entry.ts);
        if (entryDate >= cutoffDate) {
          runs.push(entry);
        }
      } catch {
        // Skip malformed JSONL lines - corrupted entries shouldn't break reporting
      }
    }
  }

  return runs.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

function aggregateFailures(runs, firstRunOnly) {
  const filtered = firstRunOnly ? runs.filter((r) => r.runNumber === 1) : runs;
  const failedRuns = filtered.filter((r) => !r.passed);

  const byCode = new Map();
  const byFile = new Map();
  const examples = new Map();

  for (const run of failedRuns) {
    for (const failure of run.failures) {
      const key = `${failure.type}:${failure.code}`;

      // Aggregate by code
      if (!byCode.has(key)) {
        byCode.set(key, { type: failure.type, code: failure.code, count: 0, files: new Set() });
      }
      const codeEntry = byCode.get(key);
      codeEntry.count++;
      codeEntry.files.add(failure.file);

      // Track best example (prefer ones with snippets)
      if (!examples.has(key) || (failure.snippet && !examples.get(key).snippet)) {
        examples.set(key, {
          message: failure.message,
          snippet: failure.snippet,
          context: failure.context,
          file: failure.file,
          line: failure.line,
        });
      }

      // Aggregate by file
      if (!byFile.has(failure.file)) {
        byFile.set(failure.file, { file: failure.file, count: 0, codes: new Set() });
      }
      const fileEntry = byFile.get(failure.file);
      fileEntry.count++;
      fileEntry.codes.add(key);
    }
  }

  // Convert to sorted arrays
  const topCodes = [...byCode.entries()]
    .map(([key, data]) => ({
      ...data,
      key,
      files: [...data.files],
      example: examples.get(key),
    }))
    .sort((a, b) => b.count - a.count);

  const topFiles = [...byFile.entries()]
    .map(([, data]) => ({
      ...data,
      codes: [...data.codes],
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalRuns: filtered.length,
    failedRuns: failedRuns.length,
    totalFailures: failedRuns.reduce((sum, r) => sum + r.failures.length, 0),
    topCodes: topCodes.slice(0, 15),
    topFiles: topFiles.slice(0, 10),
  };
}

function formatMarkdownReport(stats, firstRunOnly, days) {
  const lines = [];
  const mode = firstRunOnly ? 'First-Run' : 'All';

  lines.push(`# CI Failure Report (${mode} Failures, Last ${days} Days)\n`);
  lines.push(`Generated: ${new Date().toISOString()}\n`);

  lines.push(`## Summary\n`);
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total CI Runs | ${stats.totalRuns} |`);
  lines.push(`| Failed Runs | ${stats.failedRuns} |`);
  lines.push(`| Total Failures | ${stats.totalFailures} |`);
  lines.push(
    `| Failure Rate | ${stats.totalRuns > 0 ? ((stats.failedRuns / stats.totalRuns) * 100).toFixed(1) : 0}% |`
  );
  lines.push(``);

  if (stats.topCodes.length === 0) {
    lines.push(`No failures recorded in the specified time period.\n`);
    return lines.join('\n');
  }

  lines.push(`## Top Failure Codes\n`);
  lines.push(`| Rank | Type | Code | Count | Example |`);
  lines.push(`|------|------|------|-------|---------|`);

  for (let i = 0; i < stats.topCodes.length; i++) {
    const entry = stats.topCodes[i];
    const example = entry.example?.snippet
      ? `\`${entry.example.snippet.slice(0, 50)}${entry.example.snippet.length > 50 ? '...' : ''}\``
      : (entry.example?.message?.slice(0, 50) ?? '-');
    lines.push(`| ${i + 1} | ${entry.type} | ${entry.code} | ${entry.count} | ${example} |`);
  }
  lines.push(``);

  lines.push(`## Top Failing Files\n`);
  lines.push(`| Rank | File | Failures | Error Types |`);
  lines.push(`|------|------|----------|-------------|`);

  for (let i = 0; i < stats.topFiles.length; i++) {
    const entry = stats.topFiles[i];
    const codes = entry.codes.slice(0, 3).join(', ') + (entry.codes.length > 3 ? '...' : '');
    lines.push(`| ${i + 1} | ${entry.file} | ${entry.count} | ${codes} |`);
  }
  lines.push(``);

  lines.push(`## Detailed Examples\n`);

  for (const entry of stats.topCodes.slice(0, 5)) {
    if (!entry.example) continue;

    lines.push(`### ${entry.code} (${entry.count} occurrences)\n`);
    lines.push(`**Message:** ${entry.example.message}\n`);
    lines.push(`**File:** ${entry.example.file}:${entry.example.line}\n`);

    if (entry.example.context) {
      lines.push(`\`\`\`typescript`);
      lines.push(entry.example.context);
      lines.push(`\`\`\``);
    }
    lines.push(``);
  }

  lines.push(`## Suggested CLAUDE.md Additions\n`);
  lines.push(
    `Based on the most frequent failures, consider adding these to the Code Smells table:\n`
  );
  lines.push(`| Smell | ❌ Wrong | ✅ Fix |`);
  lines.push(`|-------|----------|--------|`);

  const suggestions = generateSuggestions(stats.topCodes.slice(0, 5));
  for (const s of suggestions) {
    lines.push(`| ${s.smell} | \`${s.wrong}\` | \`${s.fix}\` |`);
  }
  lines.push(``);

  return lines.join('\n');
}

function generateSuggestions(topCodes) {
  const suggestions = [];

  for (const entry of topCodes) {
    const code = entry.code;
    const snippet = entry.example?.snippet ?? '';

    if (code === 'TS2322') {
      suggestions.push({
        smell: 'Type mismatch',
        wrong: snippet.slice(0, 30) || 'const x: T = nullable',
        fix: 'const x = nullable ?? default',
      });
    } else if (code === '@typescript-eslint/no-floating-promises') {
      suggestions.push({
        smell: 'Floating promise',
        wrong: 'asyncFn()',
        fix: 'await asyncFn() or void asyncFn()',
      });
    } else if (code === 'TS7006') {
      suggestions.push({
        smell: 'Implicit any',
        wrong: '(item) => ...',
        fix: '(item: Type) => ...',
      });
    } else if (code === 'TS2532') {
      suggestions.push({
        smell: 'Object possibly undefined',
        wrong: 'obj.prop',
        fix: 'obj?.prop or obj!.prop',
      });
    } else if (code === 'TS2345') {
      suggestions.push({
        smell: 'Argument type mismatch',
        wrong: 'fn(wrongType)',
        fix: 'fn(correctType) or type assertion',
      });
    } else if (code.startsWith('@typescript-eslint/')) {
      suggestions.push({
        smell: code.replace('@typescript-eslint/', ''),
        wrong: snippet.slice(0, 30) || 'see lint rule',
        fix: 'follow rule guidance',
      });
    }
  }

  return suggestions.slice(0, 5);
}

(async () => {
  const { firstRunOnly, jsonOutput, days } = parseArgs();

  const runs = loadAllRuns(days);
  const stats = aggregateFailures(runs, firstRunOnly);

  if (jsonOutput) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    console.log(formatMarkdownReport(stats, firstRunOnly, days));
  }
})();
