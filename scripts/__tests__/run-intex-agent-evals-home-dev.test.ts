import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = process.cwd();
const WRAPPER_PATH = path.join(REPOSITORY_ROOT, 'scripts', 'run-intex-agent-evals-home-dev.sh');
const ROOT_PACKAGE_PATH = path.join(REPOSITORY_ROOT, 'package.json');
const EVALUATOR_PACKAGE_PATH = path.join(
  REPOSITORY_ROOT,
  'tools',
  'intex-agent-evals',
  'package.json'
);
const LOCKFILE_PATH = path.join(REPOSITORY_ROOT, 'pnpm-lock.yaml');
const GITIGNORE_PATH = path.join(REPOSITORY_ROOT, '.gitignore');

const VALID_SHA = '0123456789abcdef0123456789abcdef01234567';
const SECRET_SENTINEL = 'wrapper-secret-sentinel-2d56179a';
const GENERIC_PATH_SENTINEL = '/private/wrapper-path-sentinel-9f4f55a1';
const GENERIC_TOKEN_SENTINEL = 'generic-wrapper-token-sentinel-9867d198';
const USAGE_LINE =
  'usage: run-intex-agent-evals-home-dev.sh {setup|preflight|endpoint|full|scenario intex-eval-NNN|matrix-smoke}\n';

const IMPLEMENTATION_PATHS = [
  'apps/intex-agent/src/routes/testConversationRoutes.ts',
  'apps/intex-agent/src/domain/testConversation/',
  'tools/intex-agent-evals/',
  'scripts/run-intex-agent-evals-home-dev.sh',
  'scripts/cleanup-intex-agent-test-conversations.mjs',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.gitignore',
  'eslint.config.js',
  'tsconfig.tests-check.json',
  'scripts/lint-parallel.mjs',
  'scripts/typecheck-parallel.mjs',
  'scripts/verify-workspace-deps.mjs',
  'scripts/lib/workspace-discovery.mjs',
  'packages/llm-contract/src/types.ts',
  'packages/infra-openrouter/src/client.ts',
] as const;

const REMOTE_PROGRAM = `set -eu
if ! cd "$HOME/deploy/intexuraos" >/dev/null 2>&1; then
  printf '%s\\n' 'remote_environment_unavailable' >&2
  exit 2
fi
required_sha=$1
shift
if ! git merge-base --is-ancestor "$required_sha" HEAD >/dev/null 2>&1; then
  printf '%s\\n' 'revision_mismatch' >&2
  exit 2
fi
if ! command -v direnv >/dev/null 2>&1 || ! command -v pnpm >/dev/null 2>&1 || ! direnv exec . true >/dev/null 2>&1; then
  printf '%s\\n' 'remote_environment_unavailable' >&2
  exit 2
fi
exec direnv exec . pnpm --filter @intexuraos/intex-agent-evals run cli -- "$@"`;

const tempDirectories: string[] = [];

interface PackageManifest {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface WrapperRunOptions {
  gitStatusOutput?: string;
  gitStatusStderr?: string;
  gitStatusExit?: number;
  gitRevision?: string;
  gitRevisionStderr?: string;
  gitRevisionExit?: number;
  sshStdout?: string;
  sshStderr?: string;
  sshExit?: number;
  sshSignal?: NodeJS.Signals;
  sshParentSignal?: NodeJS.Signals;
  captureFileCreationFailure?: boolean;
  catFailureCall?: 1 | 2;
}

interface SshMetadata {
  stdoutMode: number;
  stderrMode: number;
  captureDirectoryModes: number[];
}

interface SshGenericEnvironment {
  path: string;
  token: string;
}

function createTempDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intex-agent-evals-wrapper-test-'));
  tempDirectories.push(directory);
  return directory;
}

function writeExecutable(filePath: string, contents: string): void {
  fs.writeFileSync(filePath, contents, { encoding: 'utf8', mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
}

function parseJsonLines<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function expectedRemoteCommand(cliArguments: readonly string[]): string {
  const positionalArguments = ['intex-agent-evals-home-dev', VALID_SHA, ...cliArguments];

  return `zsh -lic ${shellSingleQuote(REMOTE_PROGRAM)} ${positionalArguments
    .map(shellSingleQuote)
    .join(' ')}`;
}

function runWrapper(
  arguments_: readonly string[],
  options: WrapperRunOptions = {}
): {
  result: ReturnType<typeof spawnSync>;
  gitCalls: string[][];
  sshCalls: string[][];
  sshMetadata: SshMetadata[];
  sshSensitiveEnvironment: string[][];
  sshGenericEnvironment: SshGenericEnvironment[];
  localHome: string;
  tempRoot: string;
  captureRoot: string;
} {
  const tempRoot = createTempDirectory();
  const binDirectory = path.join(tempRoot, 'bin');
  const callerDirectory = path.join(tempRoot, 'caller-cwd');
  const captureRoot = path.join(tempRoot, 'capture');
  const localHome = path.join(tempRoot, 'local-home-must-not-expand');
  const gitLogPath = path.join(tempRoot, 'git-argv.jsonl');
  const sshLogPath = path.join(tempRoot, 'ssh-argv.jsonl');
  const sshMetadataPath = path.join(tempRoot, 'ssh-metadata.jsonl');
  const sshSensitiveEnvironmentPath = path.join(tempRoot, 'ssh-sensitive-environment.jsonl');
  const sshGenericEnvironmentPath = path.join(tempRoot, 'ssh-generic-environment.jsonl');
  const catCallCountPath = path.join(tempRoot, 'cat-call-count');

  fs.mkdirSync(binDirectory, { mode: 0o700 });
  fs.mkdirSync(callerDirectory, { mode: 0o700 });
  fs.mkdirSync(captureRoot, { mode: 0o700 });
  fs.mkdirSync(localHome, { mode: 0o700 });

  writeExecutable(
    path.join(binDirectory, 'git'),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GIT_LOG, JSON.stringify(args) + '\\n');
if (args.includes('status')) {
  process.stdout.write(process.env.FAKE_GIT_STATUS_OUTPUT || '');
  process.stderr.write(process.env.FAKE_GIT_STATUS_STDERR || '');
  process.exit(Number.parseInt(process.env.FAKE_GIT_STATUS_EXIT || '0', 10));
}
if (args.includes('rev-parse')) {
  process.stdout.write(process.env.FAKE_GIT_REVISION || '');
  process.stderr.write(process.env.FAKE_GIT_REVISION_STDERR || '');
  process.exit(Number.parseInt(process.env.FAKE_GIT_REVISION_EXIT || '0', 10));
}
process.exit(99);
`
  );

  if (options.captureFileCreationFailure === true) {
    writeExecutable(
      path.join(binDirectory, 'mktemp'),
      `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(process.env.FAKE_MKTEMP_PATH, 'not-a-directory', { mode: 0o600 });
process.stdout.write(process.env.FAKE_MKTEMP_PATH + '\\n');
`
    );
  }

  if (options.catFailureCall !== undefined) {
    writeExecutable(
      path.join(binDirectory, 'cat'),
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const previousCount = fs.existsSync(process.env.FAKE_CAT_CALL_COUNT)
  ? Number.parseInt(fs.readFileSync(process.env.FAKE_CAT_CALL_COUNT, 'utf8'), 10)
  : 0;
const callCount = previousCount + 1;
fs.writeFileSync(process.env.FAKE_CAT_CALL_COUNT, String(callCount));
if (callCount === Number.parseInt(process.env.FAKE_CAT_FAIL_ON, 10)) {
  process.stdout.write(process.env.FAKE_CAT_STDOUT);
  process.stderr.write(process.env.FAKE_CAT_STDERR);
  process.exit(73);
}
const sourcePath = args.at(-1);
process.stdout.write(fs.readFileSync(sourcePath));
`
    );
  }

  writeExecutable(
    path.join(binDirectory, 'ssh'),
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_SSH_LOG, JSON.stringify(args) + '\\n');
fs.appendFileSync(process.env.FAKE_SSH_SENSITIVE_ENVIRONMENT_LOG, JSON.stringify([
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_OPENROUTER_APP_API_KEY',
  'INTEXURAOS_ENVIRONMENT',
  'INTEXURAOS_GCP_PROJECT_ID',
].filter((name) => process.env[name] !== undefined)) + '\\n');
fs.appendFileSync(process.env.FAKE_SSH_GENERIC_ENVIRONMENT_LOG, JSON.stringify({
  path: process.env.WRAPPER_GENERIC_PATH,
  token: process.env.WRAPPER_GENERIC_TOKEN,
}) + '\\n');
const captureDirectoryModes = fs.readdirSync(process.env.TMPDIR)
  .filter((name) => name.startsWith('intex-agent-evals-home-dev.'))
  .map((name) => fs.statSync(path.join(process.env.TMPDIR, name)).mode & 0o777);
fs.appendFileSync(process.env.FAKE_SSH_METADATA_LOG, JSON.stringify({
  stdoutMode: fs.fstatSync(1).mode & 0o777,
  stderrMode: fs.fstatSync(2).mode & 0o777,
  captureDirectoryModes,
}) + '\\n');
if (process.env.FAKE_SSH_PARENT_SIGNAL) {
  process.kill(process.ppid, process.env.FAKE_SSH_PARENT_SIGNAL);
  setTimeout(() => process.exit(0), 50);
} else {
  process.stdout.write(process.env.FAKE_SSH_STDOUT || '');
  process.stderr.write(process.env.FAKE_SSH_STDERR || '');
  if (process.env.FAKE_SSH_SIGNAL) {
    process.kill(process.pid, process.env.FAKE_SSH_SIGNAL);
  }
  process.exit(Number.parseInt(process.env.FAKE_SSH_EXIT || '0', 10));
}
`
  );

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    FAKE_GIT_LOG: gitLogPath,
    FAKE_GIT_REVISION: options.gitRevision ?? `${VALID_SHA}\n`,
    FAKE_GIT_REVISION_EXIT: String(options.gitRevisionExit ?? 0),
    FAKE_GIT_REVISION_STDERR: options.gitRevisionStderr ?? '',
    FAKE_GIT_STATUS_EXIT: String(options.gitStatusExit ?? 0),
    FAKE_GIT_STATUS_OUTPUT: options.gitStatusOutput ?? '',
    FAKE_GIT_STATUS_STDERR: options.gitStatusStderr ?? '',
    FAKE_CAT_CALL_COUNT: catCallCountPath,
    FAKE_CAT_FAIL_ON: String(options.catFailureCall ?? 0),
    FAKE_CAT_STDERR: `${SECRET_SENTINEL} ${tempRoot} cat diagnostic`,
    FAKE_CAT_STDOUT: `${SECRET_SENTINEL} cat partial output`,
    FAKE_MKTEMP_PATH: path.join(captureRoot, `intex-agent-evals-home-dev.${SECRET_SENTINEL}`),
    FAKE_SSH_EXIT: String(options.sshExit ?? 0),
    FAKE_SSH_GENERIC_ENVIRONMENT_LOG: sshGenericEnvironmentPath,
    FAKE_SSH_LOG: sshLogPath,
    FAKE_SSH_METADATA_LOG: sshMetadataPath,
    FAKE_SSH_SENSITIVE_ENVIRONMENT_LOG: sshSensitiveEnvironmentPath,
    FAKE_SSH_STDERR: options.sshStderr ?? '',
    FAKE_SSH_STDOUT: options.sshStdout ?? '',
    HOME: localHome,
    INTEXURAOS_INTERNAL_AUTH_TOKEN: SECRET_SENTINEL,
    INTEXURAOS_OPENROUTER_APP_API_KEY: SECRET_SENTINEL,
    INTEXURAOS_ENVIRONMENT: SECRET_SENTINEL,
    INTEXURAOS_GCP_PROJECT_ID: SECRET_SENTINEL,
    PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
    TMPDIR: captureRoot,
    WRAPPER_GENERIC_PATH: GENERIC_PATH_SENTINEL,
    WRAPPER_GENERIC_TOKEN: GENERIC_TOKEN_SENTINEL,
  };
  if (options.sshSignal !== undefined) {
    environment.FAKE_SSH_SIGNAL = options.sshSignal;
  }
  if (options.sshParentSignal !== undefined) {
    environment.FAKE_SSH_PARENT_SIGNAL = options.sshParentSignal;
  }

  const result = spawnSync('/bin/bash', [WRAPPER_PATH, ...arguments_], {
    cwd: callerDirectory,
    encoding: 'utf8',
    env: environment,
    timeout: 30_000,
  });

  return {
    result,
    gitCalls: parseJsonLines<string[]>(gitLogPath),
    sshCalls: parseJsonLines<string[]>(sshLogPath),
    sshMetadata: parseJsonLines<SshMetadata>(sshMetadataPath),
    sshSensitiveEnvironment: parseJsonLines<string[]>(sshSensitiveEnvironmentPath),
    sshGenericEnvironment: parseJsonLines<SshGenericEnvironment>(sshGenericEnvironmentPath),
    localHome,
    tempRoot,
    captureRoot,
  };
}

function readPackageManifest(filePath: string): PackageManifest {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PackageManifest;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('Intex Agent evaluator command wiring', () => {
  it('defines the exact evaluator package and root command strings', () => {
    const rootPackage = readPackageManifest(ROOT_PACKAGE_PATH);
    const evaluatorPackage = readPackageManifest(EVALUATOR_PACKAGE_PATH);

    expect(evaluatorPackage.scripts?.cli).toBe('tsx src/cli.ts');
    expect(evaluatorPackage.devDependencies?.tsx).toBe('^4.21.0');
    expect({
      setup: rootPackage.scripts?.['eval:intex-agent:setup'],
      preflight: rootPackage.scripts?.['eval:intex-agent:preflight'],
      endpoint: rootPackage.scripts?.['eval:intex-agent:endpoint'],
      full: rootPackage.scripts?.['eval:intex-agent'],
      matrixSmoke: rootPackage.scripts?.['eval:intex-agent:matrix-smoke'],
    }).toEqual({
      setup: 'pnpm --filter @intexuraos/intex-agent-evals run cli -- setup',
      preflight: 'pnpm --filter @intexuraos/intex-agent-evals run cli -- preflight',
      endpoint: 'pnpm --filter @intexuraos/intex-agent-evals run cli -- endpoint',
      full: 'pnpm --filter @intexuraos/intex-agent-evals run cli --',
      matrixSmoke: 'pnpm --filter @intexuraos/intex-agent-evals run cli -- matrix-smoke',
    });
  });

  it('locks the direct tsx dependency for the evaluator importer', () => {
    const lockfile = fs.readFileSync(LOCKFILE_PATH, 'utf8');
    const importerMarker = '  tools/intex-agent-evals:\n';
    const importerStart = lockfile.indexOf(importerMarker);
    const nextImporter = lockfile.indexOf('\n  tools/', importerStart + importerMarker.length);

    expect(importerStart).toBeGreaterThanOrEqual(0);
    expect(nextImporter).toBeGreaterThan(importerStart);
    expect(lockfile.slice(importerStart, nextImporter)).toMatch(
      /tsx:\n\s+specifier: \^4\.21\.0\n\s+version: 4\.21\.0/
    );
  });

  it('ignores exactly the evaluator artifact directory', () => {
    const matchingLines = fs
      .readFileSync(GITIGNORE_PATH, 'utf8')
      .split(/\r?\n/u)
      .filter((line) => line === '/.artifacts/intex-agent-evals/');

    expect(matchingLines).toEqual(['/.artifacts/intex-agent-evals/']);
  });
});

describe('run-intex-agent-evals-home-dev wrapper', () => {
  it('is executable Bash with strict mode and a private umask', () => {
    expect(fs.existsSync(WRAPPER_PATH)).toBe(true);
    expect(fs.statSync(WRAPPER_PATH).mode & 0o111).not.toBe(0);

    const contents = fs.readFileSync(WRAPPER_PATH, 'utf8');
    expect(contents.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(contents).toContain('set -euo pipefail');
    expect(contents).toContain('umask 077');
  });

  it.each([
    { label: 'missing selector', arguments_: [] },
    { label: 'unknown selector', arguments_: ['unknown-selector-sentinel'] },
    { label: 'help flag', arguments_: ['--help'] },
    { label: 'root scenario alias', arguments_: ['--scenario', 'intex-eval-001'] },
    { label: 'setup extra', arguments_: ['setup', 'extra-sentinel'] },
    { label: 'preflight extra', arguments_: ['preflight', 'extra-sentinel'] },
    { label: 'endpoint extra', arguments_: ['endpoint', 'extra-sentinel'] },
    { label: 'full extra', arguments_: ['full', 'extra-sentinel'] },
    { label: 'matrix smoke extra', arguments_: ['matrix-smoke', 'extra-sentinel'] },
    { label: 'scenario missing id', arguments_: ['scenario'] },
    { label: 'scenario empty id', arguments_: ['scenario', ''] },
    { label: 'scenario short id', arguments_: ['scenario', 'intex-eval-01'] },
    { label: 'scenario long id', arguments_: ['scenario', 'intex-eval-0001'] },
    { label: 'scenario uppercase id', arguments_: ['scenario', 'INTEX-EVAL-001'] },
    { label: 'scenario non-digits', arguments_: ['scenario', 'intex-eval-abc'] },
    {
      label: 'scenario injection',
      arguments_: ['scenario', `intex-eval-001';${SECRET_SENTINEL}`],
    },
    {
      label: 'scenario extra',
      arguments_: ['scenario', 'intex-eval-001', 'extra-sentinel'],
    },
    {
      label: 'combined full scenario',
      arguments_: ['full', '--scenario', 'intex-eval-001'],
    },
    { label: 'duplicate selectors', arguments_: ['endpoint', 'full'] },
  ])(
    'rejects $label before git or ssh',
    ({ arguments_ }) => {
      const run = runWrapper(arguments_);

      expect(run.result.error).toBeUndefined();
      expect(run.result.status).toBe(2);
      expect(run.result.stdout).toBe('');
      expect(run.result.stderr).toBe(USAGE_LINE);
      expect(run.result.stderr).not.toContain(SECRET_SENTINEL);
      expect(run.gitCalls).toEqual([]);
      expect(run.sshCalls).toEqual([]);
    },
    30_000
  );

  it.each([
    { selector: 'setup', arguments_: ['setup'], cliArguments: ['setup'], tty: '-tt' },
    {
      selector: 'preflight',
      arguments_: ['preflight'],
      cliArguments: ['preflight'],
      tty: '-T',
    },
    {
      selector: 'endpoint',
      arguments_: ['endpoint'],
      cliArguments: ['endpoint'],
      tty: '-T',
    },
    { selector: 'full', arguments_: ['full'], cliArguments: ['full'], tty: '-T' },
    {
      selector: 'scenario',
      arguments_: ['scenario', 'intex-eval-003'],
      cliArguments: ['scenario', 'intex-eval-003'],
      tty: '-T',
    },
    {
      selector: 'matrix-smoke',
      arguments_: ['matrix-smoke'],
      cliArguments: ['matrix-smoke'],
      tty: '-T',
    },
  ])(
    'accepts the exact $selector selector',
    ({ arguments_, cliArguments, tty }) => {
      const run = runWrapper(arguments_, { sshStdout: 'safe remote output\n' });

      expect(run.result.error).toBeUndefined();
      expect(run.result.status).toBe(0);
      expect(run.result.stdout).toBe('safe remote output\n');
      expect(run.result.stderr).toBe('');
      expect(run.gitCalls).toEqual([
        [
          '-C',
          REPOSITORY_ROOT,
          'status',
          '--porcelain=v1',
          '--untracked-files=all',
          '--',
          ...IMPLEMENTATION_PATHS,
        ],
        ['-C', REPOSITORY_ROOT, 'rev-parse', '--verify', 'HEAD^{commit}'],
      ]);
      expect(run.sshCalls).toEqual([
        [
          tty,
          '-o',
          'LogLevel=QUIET',
          '-o',
          'SendEnv=-*',
          'home-dev',
          expectedRemoteCommand(cliArguments),
        ],
      ]);
    },
    30_000
  );

  it.each([
    { label: 'unstaged', porcelain: ' M tools/intex-agent-evals/src/cli.ts\n' },
    { label: 'staged', porcelain: 'M  package.json\n' },
    { label: 'untracked', porcelain: '?? scripts/private-path-sentinel\n' },
  ])(
    'blocks $label implementation changes without exposing a path',
    ({ porcelain }) => {
      const run = runWrapper(['endpoint'], {
        gitStatusOutput: porcelain,
        gitStatusStderr: SECRET_SENTINEL,
      });

      expect(run.result.status).toBe(2);
      expect(run.result.stdout).toBe('');
      expect(run.result.stderr).toBe('implementation_paths_dirty\n');
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(SECRET_SENTINEL);
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(porcelain.trim());
      expect(run.gitCalls).toHaveLength(1);
      expect(run.sshCalls).toEqual([]);
    },
    30_000
  );

  it(
    'fails closed when implementation cleanliness cannot be established',
    { timeout: 30_000 },
    () => {
      const run = runWrapper(['endpoint'], {
        gitStatusExit: 128,
        gitStatusStderr: SECRET_SENTINEL,
      });

      expect(run.result.status).toBe(2);
      expect(run.result.stdout).toBe('');
      expect(run.result.stderr).toBe('implementation_paths_dirty\n');
      expect(run.result.stderr).not.toContain(SECRET_SENTINEL);
      expect(run.gitCalls).toHaveLength(1);
      expect(run.sshCalls).toEqual([]);
    }
  );

  it.each([
    { label: 'short', revision: '0123456789abcdef\n' },
    { label: 'uppercase', revision: '0123456789ABCDEF0123456789ABCDEF01234567\n' },
    { label: 'non-hex', revision: 'g123456789abcdef0123456789abcdef01234567\n' },
    { label: 'leading space', revision: ` ${VALID_SHA}\n` },
    { label: 'multiple lines', revision: `${VALID_SHA}\n${SECRET_SENTINEL}\n` },
  ])(
    'rejects a $label implementation revision without ssh',
    ({ revision }) => {
      const run = runWrapper(['endpoint'], { gitRevision: revision });

      expect(run.result.status).toBe(2);
      expect(run.result.stdout).toBe('');
      expect(run.result.stderr).toBe('implementation_revision_unavailable\n');
      expect(run.result.stderr).not.toContain(revision.trim());
      expect(run.result.stderr).not.toContain(SECRET_SENTINEL);
      expect(run.gitCalls).toHaveLength(2);
      expect(run.sshCalls).toEqual([]);
    },
    30_000
  );

  it('redacts revision command failures and never invokes ssh', { timeout: 30_000 }, () => {
    const run = runWrapper(['endpoint'], {
      gitRevisionExit: 128,
      gitRevisionStderr: SECRET_SENTINEL,
    });

    expect(run.result.status).toBe(2);
    expect(run.result.stdout).toBe('');
    expect(run.result.stderr).toBe('implementation_revision_unavailable\n');
    expect(run.result.stderr).not.toContain(SECRET_SENTINEL);
    expect(run.sshCalls).toEqual([]);
  });

  it(
    'single-quotes the fixed remote program and every argument without local HOME expansion',
    { timeout: 30_000 },
    () => {
      const run = runWrapper(['scenario', 'intex-eval-003']);
      const sshArguments = run.sshCalls[0] ?? [];
      const remoteCommand = sshArguments[6] ?? '';
      const parseResult = spawnSync(
        '/bin/zsh',
        ['-fc', `set -- ${remoteCommand}; printf '%s\\0' "$@"`],
        { encoding: 'utf8', timeout: 30_000 }
      );

      expect(run.result.status).toBe(0);
      expect(sshArguments).toEqual([
        '-T',
        '-o',
        'LogLevel=QUIET',
        '-o',
        'SendEnv=-*',
        'home-dev',
        expectedRemoteCommand(['scenario', 'intex-eval-003']),
      ]);
      expect(remoteCommand).toContain('zsh -lic ');
      expect(remoteCommand).toContain("'\\''remote_environment_unavailable'\\''");
      expect(remoteCommand).toContain('$HOME/deploy/intexuraos');
      expect(remoteCommand).not.toContain(run.localHome);
      expect(remoteCommand).toContain(
        'git merge-base --is-ancestor "$required_sha" HEAD >/dev/null 2>&1'
      );
      expect(remoteCommand).toContain('command -v direnv >/dev/null 2>&1');
      expect(remoteCommand).toContain('command -v pnpm >/dev/null 2>&1');
      expect(remoteCommand).toContain('direnv exec . true >/dev/null 2>&1');
      expect(remoteCommand).toContain(
        'exec direnv exec . pnpm --filter @intexuraos/intex-agent-evals run cli -- "$@"'
      );
      expect(parseResult.error).toBeUndefined();
      expect(parseResult.status).toBe(0);
      expect(parseResult.stderr).toBe('');
      expect(parseResult.stdout.split('\0').slice(0, -1)).toEqual([
        'zsh',
        '-lic',
        REMOTE_PROGRAM,
        'intex-agent-evals-home-dev',
        VALID_SHA,
        'scenario',
        'intex-eval-003',
      ]);
    }
  );

  it.each([0, 1, 2])(
    'preserves remote status %i and safe output',
    (status) => {
      const run = runWrapper(['endpoint'], {
        sshExit: status,
        sshStdout: `safe stdout ${String(status)}\n`,
        sshStderr: `safe stderr ${String(status)}\n`,
      });

      expect(run.result.status).toBe(status);
      expect(run.result.stdout).toBe(`safe stdout ${String(status)}\n`);
      expect(run.result.stderr).toBe(`safe stderr ${String(status)}\n`);
    },
    30_000
  );

  it.each([42, 127, 255])(
    'normalizes remote status %i and discards remote output',
    (status) => {
      const run = runWrapper(['endpoint'], {
        sshExit: status,
        sshStdout: `${SECRET_SENTINEL} ${VALID_SHA} ${runMarker(status)}\n`,
        sshStderr: `${REMOTE_PROGRAM} ${runMarker(status)}\n`,
      });

      expect(run.result.status).toBe(2);
      expect(run.result.stdout).toBe('');
      expect(run.result.stderr).toBe('remote_execution_failed\n');
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(SECRET_SENTINEL);
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(VALID_SHA);
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(run.tempRoot);
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain('zsh -lic');
    },
    30_000
  );

  it('normalizes a signaled ssh process to infrastructure failure', { timeout: 30_000 }, () => {
    const run = runWrapper(['endpoint'], {
      sshSignal: 'SIGTERM',
      sshStdout: SECRET_SENTINEL,
      sshStderr: SECRET_SENTINEL,
    });

    expect(run.result.status).toBe(2);
    expect(run.result.stdout).toBe('');
    expect(run.result.stderr).toBe('remote_execution_failed\n');
  });

  it.each([
    { selector: 'setup', arguments_: ['setup'], signal: 'SIGHUP' },
    { selector: 'setup', arguments_: ['setup'], signal: 'SIGINT' },
    { selector: 'setup', arguments_: ['setup'], signal: 'SIGTERM' },
    { selector: 'endpoint', arguments_: ['endpoint'], signal: 'SIGHUP' },
    { selector: 'endpoint', arguments_: ['endpoint'], signal: 'SIGINT' },
    { selector: 'endpoint', arguments_: ['endpoint'], signal: 'SIGTERM' },
  ] as const)(
    'normalizes parent $signal during $selector to one static failure',
    ({ arguments_, signal }) => {
      const run = runWrapper(arguments_, { sshParentSignal: signal });

      expect(run.result.status).toBe(2);
      expect(run.result.stdout).toBe('');
      expect(run.result.stderr).toBe('remote_execution_failed\n');
    },
    30_000
  );

  it(
    'uses private capture paths and removes them after safe pass-through',
    { timeout: 30_000 },
    () => {
      const run = runWrapper(['endpoint'], {
        sshStdout: 'safe stdout\n',
        sshStderr: 'safe stderr\n',
      });

      expect(run.result.status).toBe(0);
      expect(run.sshMetadata).toEqual([
        {
          stdoutMode: 0o600,
          stderrMode: 0o600,
          captureDirectoryModes: [0o700],
        },
      ]);
      expect(
        fs
          .readdirSync(run.captureRoot)
          .filter((name) => name.startsWith('intex-agent-evals-home-dev.'))
      ).toEqual([]);
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(run.captureRoot);
    }
  );

  it(
    'suppresses capture-file creation diagnostics and normalizes the failure',
    { timeout: 30_000 },
    () => {
      const run = runWrapper(['endpoint'], { captureFileCreationFailure: true });

      expect(run.result.status).toBe(2);
      expect(run.result.stdout).toBe('');
      expect(run.result.stderr).toBe('remote_execution_failed\n');
      expect(run.result.stderr).not.toContain(SECRET_SENTINEL);
      expect(run.result.stderr).not.toContain(run.tempRoot);
      expect(run.sshCalls).toEqual([]);
    }
  );

  it.each([1, 2] as const)(
    'suppresses capture replay failure %i before passing through either stream',
    (catFailureCall) => {
      const run = runWrapper(['endpoint'], {
        catFailureCall,
        sshStdout: 'safe stdout must remain buffered\n',
        sshStderr: 'safe stderr must remain buffered\n',
      });

      expect(run.result.status).toBe(2);
      expect(run.result.stdout).toBe('');
      expect(run.result.stderr).toBe('remote_execution_failed\n');
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(SECRET_SENTINEL);
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(run.tempRoot);
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain('must remain buffered');
    },
    30_000
  );

  it(
    'does not forward configured secrets or print the command, argv, SHA, or temp path',
    { timeout: 30_000 },
    () => {
      const run = runWrapper(['endpoint'], {
        sshStdout: 'evaluation result PASS exit 0\n',
      });
      const serializedSshArguments = JSON.stringify(run.sshCalls);
      const output = `${run.result.stdout}${run.result.stderr}`;

      expect(run.result.status).toBe(0);
      expect(serializedSshArguments).not.toContain(SECRET_SENTINEL);
      expect(output).toBe('evaluation result PASS exit 0\n');
      expect(output).not.toContain(SECRET_SENTINEL);
      expect(output).not.toContain(VALID_SHA);
      expect(output).not.toContain('zsh -lic');
      expect(output).not.toContain('@intexuraos/intex-agent-evals');
      expect(output).not.toContain(run.tempRoot);
    }
  );

  it(
    'removes sensitive local environment variables from the ssh process',
    { timeout: 30_000 },
    () => {
      const run = runWrapper(['endpoint']);

      expect(run.result.status).toBe(0);
      expect(run.sshSensitiveEnvironment).toEqual([[]]);
    }
  );

  it(
    'disables ssh_config SendEnv forwarding for generic inherited path and token values',
    { timeout: 30_000 },
    () => {
      const run = runWrapper(['endpoint']);
      const sshArguments = run.sshCalls[0] ?? [];

      expect(run.result.status).toBe(0);
      expect(run.sshGenericEnvironment).toEqual([
        { path: GENERIC_PATH_SENTINEL, token: GENERIC_TOKEN_SENTINEL },
      ]);
      expect(sshArguments).toContain('SendEnv=-*');
      expect(JSON.stringify(sshArguments)).not.toContain(GENERIC_PATH_SENTINEL);
      expect(JSON.stringify(sshArguments)).not.toContain(GENERIC_TOKEN_SENTINEL);
    }
  );
});

function runMarker(status: number): string {
  return `unexpected-status-${String(status)}`;
}
