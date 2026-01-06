#!/usr/bin/env node
/**
 * CI Pipeline Orchestrator
 *
 * Runs CI checks in phases with parallelization for speed.
 * Phases are ordered by failure likelihood (fail-fast).
 *
 * Phase 1: Static Validation (quick checks, rarely fail)
 * Phase 2: Type & Lint (medium failure rate, run in parallel)
 * Phase 3: Tests (highest failure rate, longest running)
 * Phase 4: Build & Format (final quality checks, run in parallel)
 */

import { spawn } from 'node:child_process';

// Phase definitions
const phases = [
  {
    name: 'Static Validation',
    parallel: true,
    commands: [
      'verify:package-json',
      'verify:boundaries',
      'verify:common',
      'verify:firestore',
      'verify:test-isolation',
      'verify:vitest-config',
      'verify:endpoints',
      'verify:hash-routing',
      'verify:terraform-secrets',
      'verify:pubsub',
      'verify:workspace-deps',
      'verify:migrations',
      'verify:no-console',
      'verify:llm-architecture',
    ],
  },
  {
    name: 'Type & Lint Checks',
    parallel: true,
    commands: ['typecheck', 'typecheck:tests', 'lint'],
  },
  {
    name: 'Tests',
    parallel: false,
    commands: ['test:coverage'],
  },
  {
    name: 'Build & Format',
    parallel: true,
    commands: ['build', 'format'],
  },
];

// Run commands in parallel or sequential
async function runPhase(phase) {
  console.log(`\n=== ${phase.name} ===\n`);

  if (phase.parallel) {
    await runParallel(phase.commands);
  } else {
    for (const cmd of phase.commands) {
      await runCommand(cmd);
    }
  }
}

// Run commands in parallel with cleanup on first failure
async function runParallel(commands) {
  const activeProcesses = [];

  const promises = commands.map((cmd) => {
    return new Promise((resolve, reject) => {
      const proc = spawn('npm', ['run', cmd], {
        stdio: 'inherit',
      });

      activeProcesses.push(proc);

      proc.on('close', (code) => {
        // Remove from active list
        const idx = activeProcesses.indexOf(proc);
        if (idx !== -1) activeProcesses.splice(idx, 1);

        if (code !== 0) {
          reject(new Error(`${cmd} failed with code ${code}`));
        } else {
          resolve();
        }
      });
    });
  });

  try {
    await Promise.all(promises);
  } catch (error) {
    // Kill remaining processes on failure
    for (const proc of activeProcesses) {
      proc.kill('SIGTERM');
    }
    throw error;
  }
}

function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['run', cmd], {
      stdio: 'inherit',
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${cmd} failed with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

// Main execution
(async () => {
  try {
    for (const phase of phases) {
      await runPhase(phase);
    }
    console.log('\n✅ CI passed\n');
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ CI failed: ${error.message}\n`);
    process.exit(1);
  }
})();
