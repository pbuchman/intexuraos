#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeleteCommands, readJsonFile } from './lib.mjs';

function parseArgs(argv) {
  const options = {
    batchSize: 50,
    execute: false,
    plan: null,
    scope: 'retired-packages',
  };

  for (const arg of argv) {
    if (arg === '--execute') {
      options.execute = true;
      continue;
    }
    if (arg.startsWith('--plan=')) {
      options.plan = arg.slice('--plan='.length);
      continue;
    }
    if (arg.startsWith('--scope=')) {
      options.scope = arg.slice('--scope='.length);
      continue;
    }
    if (arg.startsWith('--batch-size=')) {
      options.batchSize = Number.parseInt(arg.slice('--batch-size='.length), 10);
      continue;
    }
    if (arg === '--help') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function printUsage() {
  console.log(
    `Usage: node scripts/artifact-registry/apply-prune-plan.mjs --plan=<path> [--scope=retired-packages|all|package:<name>] [--execute] [--batch-size=50]`
  );
}

export function executePlan(plan, scope, { execute = false, batchSize = 50 } = {}) {
  const commands = buildDeleteCommands(plan, scope).slice(0, batchSize);

  if (!execute) {
    for (const item of commands) {
      console.log(item.command);
    }
    return commands.length;
  }

  for (const item of commands) {
    execFileSync('bash', ['-lc', item.command], { stdio: 'inherit' });
  }

  return commands.length;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help || !options.plan) {
    printUsage();
    return options.help ? 0 : 1;
  }

  const plan = readJsonFile(options.plan);
  executePlan(plan, options.scope, {
    batchSize: options.batchSize,
    execute: options.execute,
  });
  return 0;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  main().then(
    (exitCode) => {
      process.exit(exitCode);
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  );
}
