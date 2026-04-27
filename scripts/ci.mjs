#!/usr/bin/env node
/**
 * CI Pipeline
 *
 * Runs CI checks in phases with clean, scannable output.
 * Phases are ordered by failure likelihood (fail-fast).
 * Parallel phases use abort-on-first-failure for faster feedback.
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');

// Phases ordered by failure likelihood (most failures first = fail fast)
const phases = [
  {
    name: 'Type & Lint',
    parallel: true,
    failFast: true,
    commands: [
      { name: 'typecheck', run: 'pnpm run typecheck' },
      { name: 'typecheck:tests', run: 'pnpm run typecheck:tests' },
      { name: 'lint', run: 'pnpm run lint' },
    ],
  },
  {
    name: 'Tests',
    parallel: false,
    commands: [
      {
        name: 'test:coverage',
        run: 'pnpm run test:coverage',
        saveTo: 'scripts/test-results/test-output.txt',
      },
      { name: 'test-stdout', script: 'verify-test-stdout.mjs' },
    ],
  },
  {
    name: 'Static Validation',
    parallel: true,
    failFast: true,
    commands: [
      { name: 'package-json', script: 'verify-package-json.mjs' },
      { name: 'package-exports', script: 'verify-package-exports.mjs' },
      { name: 'date-formatting', script: 'verify-date-formatting.mjs' },
      { name: 'dead-code', script: 'verify-dead-code.mjs' },
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
      { name: 'reply-send', script: 'verify-reply-send.mjs' },
      { name: 'sentry-logging', script: 'verify-sentry-logging.mjs' },
      { name: 'v8-ignore', script: 'verify-v8-ignore.mjs' },
      { name: 'error-serializers', script: 'verify-error-serializers.mjs' },
      { name: 'prompt-versions', script: 'verify-prompt-versions.mjs' },
      { name: 'llm-architecture', run: 'npx tsx scripts/verify-llm-architecture.ts' },
      { name: 'web-env-lockstep', run: 'node scripts/ci/check-web-env-lockstep.cjs' },
    ],
  },
  {
    name: 'Build & Format',
    parallel: true,
    failFast: true,
    commands: [
      { name: 'build', run: 'pnpm run build' },
      { name: 'format', run: 'pnpm run format' },
    ],
  },
  {
    name: 'Post-Build Checks',
    parallel: false,
    commands: [{ name: 'web-bundle-budget', run: 'node scripts/ci/check-web-bundle-budget.cjs' }],
  },
];

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function extractSummary(output) {
  const clean = stripAnsi(output);
  const lines = clean.trim().split('\n');

  const testsMatch = clean.match(/Tests\s+(\d+)\s+passed/);
  if (testsMatch) {
    return `${testsMatch[1]} tests passed`;
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.includes('✓') || line.includes('✅')) {
      let summary = line.replace(/^✓\s*/, '').replace(/^✅\s*/, '');
      if (summary.length > 60) summary = summary.slice(0, 57) + '...';
      return summary;
    }
  }

  if (clean.includes('passed') || clean.includes('success')) {
    return 'passed';
  }
  return 'completed';
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Run a command with abort signal support.
 * Returns result with timing and aborted status.
 */
async function runCommand(cmd, abortSignal = null) {
  const startTime = Date.now();

  if (abortSignal?.aborted) {
    return {
      name: cmd.name,
      code: 0,
      output: '',
      summary: 'aborted',
      aborted: true,
      duration: 0,
    };
  }

  return new Promise((resolve) => {
    let command, args;

    if (cmd.script) {
      command = 'node';
      args = [`scripts/${cmd.script}`];
    } else if (cmd.run) {
      command = 'sh';
      args = ['-c', cmd.run];
    } else {
      resolve({
        name: cmd.name,
        code: 1,
        output: 'Invalid command config',
        summary: 'error',
        aborted: false,
        duration: 0,
      });
      return;
    }

    const env = { ...process.env };
    delete env.NO_COLOR;

    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: repoRoot,
      env,
    });

    let output = '';
    let wasAborted = false;

    proc.stdout.on('data', (d) => (output += d.toString()));
    proc.stderr.on('data', (d) => (output += d.toString()));

    const abortHandler = () => {
      wasAborted = true;
      proc.kill('SIGTERM');
    };

    if (abortSignal) {
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    }

    proc.on('close', (code) => {
      if (abortSignal) {
        abortSignal.removeEventListener('abort', abortHandler);
      }

      const duration = Date.now() - startTime;

      if (wasAborted) {
        resolve({
          name: cmd.name,
          code: 0,
          output: '',
          summary: 'aborted',
          aborted: true,
          duration,
        });
        return;
      }

      if (cmd.saveTo) {
        const savePath = join(repoRoot, cmd.saveTo);
        mkdirSync(dirname(savePath), { recursive: true });
        writeFileSync(savePath, output);
      }

      const summary = code === 0 ? extractSummary(output) : 'FAILED';
      resolve({
        name: cmd.name,
        code: code ?? 1,
        output,
        summary,
        aborted: false,
        duration,
      });
    });
  });
}

/**
 * Run phase with fail-fast: abort remaining commands on first failure.
 */
async function runPhaseFailFast(phase, phaseNumber) {
  console.log(`\n=== ${phase.name} ===\n`);

  const phaseStart = Date.now();
  const abortController = new AbortController();
  let firstFailure = null;

  const commandPromises = phase.commands.map(async (cmd) => {
    const result = await runCommand(cmd, abortController.signal);

    if (result.code !== 0 && !result.aborted && !firstFailure) {
      firstFailure = result;
      abortController.abort();
    }

    return result;
  });

  const results = await Promise.allSettled(commandPromises);
  const phaseDuration = Date.now() - phaseStart;

  const commandResults = results
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean);

  let abortedCount = 0;
  for (const result of commandResults) {
    if (result.aborted) {
      console.log(`[${result.name}] ⊘ aborted (${formatDuration(result.duration)})`);
      abortedCount++;
    } else if (result.code === 0) {
      console.log(`[${result.name}] ✓ ${result.summary} (${formatDuration(result.duration)})`);
    } else {
      console.log(`[${result.name}] ✗ FAILED (${formatDuration(result.duration)})`);
    }
  }

  const status = firstFailure ? 'fail' : 'pass';
  console.log(`@@PHASE_TIMING@@${phase.name}|${phaseNumber}|${status}|${phaseDuration}`);

  if (abortedCount > 0 && firstFailure) {
    console.log(`\n⚡ Early exit: ${abortedCount} command(s) aborted after first failure`);
  }

  if (firstFailure) {
    console.log(`\n─── ${firstFailure.name} output ───\n`);
    console.log(firstFailure.output.trim());
    console.log(`\n${'─'.repeat(30)}\n`);
    throw new Error(`${firstFailure.name} failed`);
  }
}

/**
 * Run phase sequentially (no abort needed).
 */
async function runPhaseSequential(phase, phaseNumber) {
  console.log(`\n=== ${phase.name} ===\n`);

  const phaseStart = Date.now();
  const results = [];

  for (const cmd of phase.commands) {
    const result = await runCommand(cmd);
    results.push(result);

    if (result.code === 0) {
      console.log(`[${result.name}] ✓ ${result.summary} (${formatDuration(result.duration)})`);
    } else {
      console.log(`[${result.name}] ✗ FAILED (${formatDuration(result.duration)})`);

      const phaseDuration = Date.now() - phaseStart;
      console.log(`@@PHASE_TIMING@@${phase.name}|${phaseNumber}|fail|${phaseDuration}`);

      console.log(`\n─── ${result.name} output ───\n`);
      console.log(result.output.trim());
      console.log(`\n${'─'.repeat(30)}\n`);
      throw new Error(`${result.name} failed`);
    }
  }

  const phaseDuration = Date.now() - phaseStart;
  console.log(`@@PHASE_TIMING@@${phase.name}|${phaseNumber}|pass|${phaseDuration}`);
}

/**
 * Run phase with appropriate strategy.
 */
async function runPhase(phase, phaseNumber) {
  if (phase.parallel && phase.failFast) {
    await runPhaseFailFast(phase, phaseNumber);
  } else if (phase.parallel) {
    await runPhaseFailFast(phase, phaseNumber);
  } else {
    await runPhaseSequential(phase, phaseNumber);
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
