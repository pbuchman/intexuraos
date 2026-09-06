#!/usr/bin/env node

import { renderRuntimeConfig } from './lib/runtime-config.mjs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function readOptionValue(args, index, option) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseArgs(args) {
  let environment;
  let format;
  let configRoot;
  const keys = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--environment') {
      environment = readOptionValue(args, index, '--environment');
      index += 1;
    } else if (argument === '--format') {
      format = readOptionValue(args, index, '--format');
      index += 1;
    } else if (argument === '--config-root') {
      configRoot = readOptionValue(args, index, '--config-root');
      index += 1;
    } else if (argument === '--key') {
      keys.push(readOptionValue(args, index, '--key'));
      index += 1;
    } else {
      throw new Error('Unknown runtime config argument');
    }
  }

  if (environment === undefined) throw new Error('--environment is required');
  if (format === undefined) throw new Error('--format is required');
  return {
    environment,
    format,
    ...(configRoot === undefined ? {} : { configRoot }),
    ...(keys.length === 0 ? {} : { keys }),
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  process.stdout.write(renderRuntimeConfig(options));
} catch (error) {
  fail(error instanceof Error ? error.message : 'Runtime configuration failed');
}
