#!/usr/bin/env node
/**
 * CI Pipeline ResearchAgent
 *
 * Runs CI checks in phases with clean, scannable output.
 * Phases are ordered by failure likelihood (fail-fast).
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');

const phases = [
  {
    name: 'Static Validation',
    parallel: true,
    commands: [
      { name: 'package-json', script: 'verify-package-json.mjs' },
      { name: 'date-formatting', script: 'verify-date-formatting.mjs' },
      { name: 'boundaries', script: 'verify-boundaries.mjs' },
      { name: 'common', script: 'verify-common.mjs' },
      { name: 'env-vars', script: 'verify-env-vars.mjs' },
      { name: 'firestore', script: 'verify-firestore-ownership.mjs' },
      { name: 'test-isolation', script: 'verify-test-isolation.mjs' },
      { name: 'vitest-config', script: 'verify-vitest-config.mjs' },
      { name: 'endpoints', script: 'verify-required-endpoints.mjs' },
      { name: 'hash-routing', script: 'verify-hash-routing.mjs' },
      { name: 'terraform-secrets', script: 'verify-terraform-secrets.mjs' },
      { name: 'pubsub', script: 'verify-pubsub.mjs' },
      { name: 'logging', script: 'verify-logging.mjs' },
      { name: 'workspace-deps', script: 'verify-workspace-deps.mjs' },
      { name: 'migrations', script: 'verify-migrations.mjs' },
      { name: 'no-console', script: 'verify-no-console.mjs' },
      { name: 'llm-architecture', run: 'npx tsx scripts/verify-llm-architecture.ts' },
    ],
  },
  {
    name: 'Type & Lint',
    parallel: true,
    commands: [
      { name: 'typecheck', run: 'pnpm run typecheck' },
      { name: 'typecheck:tests', run: 'pnpm run typecheck:tests' },
      { name: 'lint', run: 'pnpm run lint' },
    ],
  },
  {
    name: 'Tests',
    parallel: false,
    commands: [{ name: 'test:coverage', run: 'pnpm run test:coverage' }],
  },
  {
    name: 'Build & Format',
    parallel: true,
    commands: [
      { name: 'build', run: 'pnpm run build' },
      { name: 'format', run: 'pnpm run format' },
    ],
  },
];

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function extractSummary(output) {
  const clean = stripAnsi(output);
  const lines = clean.trim().split('\n');

  // Special handling for vitest output
  const testsMatch = clean.match(/Tests\s+(\d+)\s+passed/);
  if (testsMatch) {
    return `${testsMatch[1]} tests passed`;
  }

  // Look for lines with ✓ or ✅
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.includes('✓') || line.includes('✅')) {
      let summary = line.replace(/^✓\s*/, '').replace(/^✅\s*/, '');
      if (summary.length > 60) summary = summary.slice(0, 57) + '...';
      return summary;
    }
  }

  // Fallback: look for common success patterns
  if (clean.includes('passed') || clean.includes('success')) {
    return 'passed';
  }
  return 'completed';
}

async function runCommand(cmd) {
  return new Promise((resolve) => {
    let command, args;

    if (cmd.script) {
      command = 'node';
      args = [`scripts/${cmd.script}`];
    } else if (cmd.run) {
      command = 'sh';
      args = ['-c', cmd.run];
    } else {
      resolve({ name: cmd.name, code: 1, output: 'Invalid command config', summary: 'error' });
      return;
    }

    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: repoRoot,
    });

    let output = '';
    proc.stdout.on('data', (d) => (output += d.toString()));
    proc.stderr.on('data', (d) => (output += d.toString()));

    proc.on('close', (code) => {
      const summary = code === 0 ? extractSummary(output) : 'FAILED';
      resolve({ name: cmd.name, code, output, summary });
    });
  });
}

async function runPhase(phase, phaseNumber) {
  console.log(`\n=== ${phase.name} ===\n`);

  const phaseStart = Date.now();
  let results;

  if (phase.parallel) {
    results = await Promise.all(phase.commands.map(runCommand));
  } else {
    results = [];
    for (const cmd of phase.commands) {
      const result = await runCommand(cmd);
      results.push(result);
    }
  }

  let failed = null;

  for (const result of results) {
    if (result.code === 0) {
      console.log(`[${result.name}] ✓ ${result.summary}`);
    } else {
      console.log(`[${result.name}] ✗ FAILED`);
      if (!failed) failed = result;
    }
  }

  const phaseDuration = Date.now() - phaseStart;
  const status = failed ? 'fail' : 'pass';
  console.log(`@@PHASE_TIMING@@${phase.name}|${phaseNumber}|${status}|${phaseDuration}`);

  if (failed) {
    console.log(`\n─── ${failed.name} output ───\n`);
    console.log(failed.output.trim());
    console.log(`\n${'─'.repeat(30)}\n`);
    throw new Error(`${failed.name} failed`);
  }
}

(async () => {
  try {
    for (let i = 0; i < phases.length; i++) {
      await runPhase(phases[i], i + 1);
    }
    console.log('\n✅ CI passed\n');
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ CI failed: ${error.message}\n`);
    process.exit(1);
  }
})();
