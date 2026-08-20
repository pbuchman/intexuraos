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
const PLAN_PATH = path.join(
  REPOSITORY_ROOT,
  'docs',
  'superpowers',
  'plans',
  '2026-07-14-intex-agent-quality-program-implementation.md'
);

const VALID_SHA = '0123456789abcdef0123456789abcdef01234567';
const SECRET_SENTINEL = 'wrapper-secret-sentinel-2d56179a';
const GENERIC_PATH_SENTINEL = '/private/wrapper-path-sentinel-9f4f55a1';
const GENERIC_TOKEN_SENTINEL = 'generic-wrapper-token-sentinel-9867d198';
const USAGE_LINE =
  'usage: run-intex-agent-evals-home-dev.sh {setup|preflight|endpoint|full|scenario intex-eval-NNN|matrix-smoke}\n';
const FRAME_PLACEHOLDER = '0123456789abcdef0123456789abcdef0123456789abcdef';
const FRAME_PATTERN = /[a-f0-9]{48}/u;

const IMPLEMENTATION_PATHS = [
  'apps/intex-agent/src/',
  'apps/whatsapp-service/src/',
  'apps/user-service/src/',
  'packages/',
  'tools/intex-agent-evals/',
  'scripts/hetzner/nginx/',
  'scripts/run-intex-agent-evals-home-dev.sh',
  'scripts/run-intex-agent-evals-prod.sh',
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
] as const;

const REMOTE_PROGRAM = `set -eu
frame_id=$1
shift
case $frame_id in
  (*[!a-f0-9]*|'') exit 2 ;;
esac
if [ \${#frame_id} -ne 48 ]; then
  exit 2
fi
emit() {
  printf '%s\\n' "$1" >&3
}
finish() {
  emit "__INTEX_AGENT_EVAL_\${frame_id}_END_$1__"
  exit "$1"
}
emit "__INTEX_AGENT_EVAL_\${frame_id}_BEGIN__"
if ! cd "$HOME/deploy/intexuraos" >/dev/null 2>&1; then
  emit 'remote_environment_unavailable'
  finish 2
fi
required_sha=$1
shift
if ! deployed_sha=$(git rev-parse --verify 'HEAD^{commit}' 2>/dev/null); then
  emit 'revision_mismatch'
  finish 2
fi
if [ "$deployed_sha" != "$required_sha" ]; then
  emit 'revision_mismatch'
  finish 2
fi
if [ \${#deployed_sha} -ne 40 ]; then
  emit 'revision_mismatch'
  finish 2
fi
if ! remote_status=$(git status --porcelain=v1 --untracked-files=all -- \\
  apps/intex-agent/src/ apps/whatsapp-service/src/ apps/user-service/src/ \\
  packages/ \\
  tools/intex-agent-evals/ scripts/hetzner/nginx/ \\
  scripts/run-intex-agent-evals-home-dev.sh \\
  scripts/run-intex-agent-evals-prod.sh package.json 2>/dev/null); then
  emit 'remote_implementation_paths_dirty'
  finish 2
fi
if [ -n "$remote_status" ]; then
  emit 'remote_implementation_paths_dirty'
  finish 2
fi
if ! command -v direnv >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1 || ! direnv exec . true >/dev/null 2>&1; then
  emit 'remote_environment_unavailable'
  finish 2
fi
set +e
if [ "\${1-}" = 'matrix-corpus' ]; then
  direnv exec . env \\
    INTEXURAOS_ENVIRONMENT=prod \\
    INTEXURAOS_MATRIX_CORPUS_ENABLED=true \\
    INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME=hetzner-prod \\
    INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE=hetzner-prod \\
    INTEXURAOS_EVAL_REQUESTED_REVISION="$required_sha" \\
    INTEXURAOS_EVAL_DEPLOYED_REVISION="$deployed_sha" \\
    INTEXURAOS_EVAL_WRAPPER_ATTESTED=true \\
    INTEXURAOS_EVAL_LOCAL_CRITICAL_PATHS_CLEAN=true \\
    INTEXURAOS_EVAL_REMOTE_CRITICAL_PATHS_CLEAN=true \\
    node --no-warnings --import tsx tools/intex-agent-evals/src/cli.ts "$@" >&3 2>/dev/null
else
  direnv exec . env \\
    INTEXURAOS_EVAL_REQUESTED_REVISION="$required_sha" \\
    INTEXURAOS_EVAL_DEPLOYED_REVISION="$deployed_sha" \\
    INTEXURAOS_EVAL_WRAPPER_ATTESTED=true \\
    INTEXURAOS_EVAL_LOCAL_CRITICAL_PATHS_CLEAN=true \\
    INTEXURAOS_EVAL_REMOTE_CRITICAL_PATHS_CLEAN=true \\
    node --no-warnings --import tsx tools/intex-agent-evals/src/cli.ts "$@" >&3 2>/dev/null
fi
cli_status=$?
set -e
finish "$cli_status"`;

const tempDirectories: string[] = [];
const executableTemporaryDirectory = process.platform === 'linux' ? '/var/tmp' : os.tmpdir();

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
  const directory = fs.mkdtempSync(
    path.join(executableTemporaryDirectory, 'intex-agent-evals-wrapper-test-')
  );
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

function expectedRemoteCommand(cliArguments: readonly string[], frameId: string): string {
  const positionalArguments = ['intex-agent-evals-home-dev', frameId, VALID_SHA, ...cliArguments];

  return `exec 3>&1; exec zsh -lic ${shellSingleQuote(REMOTE_PROGRAM)} ${positionalArguments
    .map(shellSingleQuote)
    .join(' ')} >/dev/null 2>&1`;
}

function framedOutput(payload: string, status: number): string {
  return `__INTEX_AGENT_EVAL_${FRAME_PLACEHOLDER}_BEGIN__\n${payload}__INTEX_AGENT_EVAL_${FRAME_PLACEHOLDER}_END_${String(status)}__\n`;
}

function preflightPayload(status: 0 | 2 = 0): string {
  if (status === 2) {
    return 'preflight check runtime FAIL HOME_DEV_REQUIRED\npreflight result FAIL HOME_DEV_REQUIRED\n';
  }
  return (
    'preflight check runtime PASS\n' +
    'preflight result PASS host home-dev intex-agent 8134 whatsapp-service 8113 ' +
    'matrix-adapter 8099 judge or:minimax/minimax-m3 scenarios 10 account operator-one\n'
  );
}

function setupPayload(): string {
  return (
    'setup input account_alias\n' +
    'setup input canonical_user_id\n' +
    'setup input matrix_user_id\n' +
    'setup input matrix_access_token_file\n' +
    'setup input matrix_targets_file\n' +
    'setup check runtime PASS\n' +
    'setup result PASS created account operator-one\n'
  );
}

function evaluationPayload(
  command: 'endpoint' | 'full' | 'scenario' | 'matrix-smoke',
  status: 0 | 1 | 2,
  scenarioId = 'intex-eval-003'
): string {
  const run = `evaluation run eval-run-123 command ${command}\n${preflightPayload(0)}`;
  const scenario =
    command === 'endpoint' || command === 'full' || command === 'scenario'
      ? `scenario ${scenarioId} ${status === 0 ? 'PASS' : status === 1 ? 'BEHAVIORAL_FAILURE' : 'INFRASTRUCTURE_FAILURE'}\n`
      : '';
  const matrix =
    command === 'matrix-smoke' || command === 'full'
      ? `matrix-smoke ${status === 0 ? 'PASS' : status === 1 ? 'BEHAVIORAL_FAILURE' : 'INFRASTRUCTURE_FAILURE'}\n`
      : '';
  const result =
    status === 0
      ? 'evaluation result PASS exit 0\n'
      : status === 1
        ? 'evaluation result BEHAVIORAL_FAILURE exit 1\n'
        : 'evaluation result INFRASTRUCTURE_FAILURE exit 2\n';
  return `${run}${scenario}${matrix}${result}evaluation report .artifacts/intex-agent-evals/eval-run-123\n`;
}

function matrixCorpusPayload(status: 0 | 1 | 2): string {
  const runId = 'eval-run-123';
  const scenarios = Array.from(
    { length: 20 },
    (_, offset) =>
      `scenario intex-eval-${String(offset + 1).padStart(3, '0')} ${
        status === 0 ? 'PASS' : status === 1 ? 'BEHAVIORAL_FAILURE' : 'INFRASTRUCTURE_FAILURE'
      }\n`
  ).join('');
  const result =
    status === 0
      ? 'evaluation result PASS exit 0\n'
      : status === 1
        ? 'evaluation result BEHAVIORAL_FAILURE exit 1\n'
        : 'evaluation result INFRASTRUCTURE_FAILURE exit 2\n';
  const reportLine =
    status === 2 ? '' : `evaluation report .artifacts/intex-agent-evals/${runId}\n`;
  return `preflight result PASS\nevaluation run ${runId} command matrix-corpus\n${scenarios}${result}${reportLine}`;
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
const remoteCommand = args.at(-1) || '';
const frameMatch = remoteCommand.match(/[a-f0-9]{48}/u);
const frameId = frameMatch ? frameMatch[0] : '';
const materialize = (value) => value.replaceAll('${FRAME_PLACEHOLDER}', frameId);
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
  process.stdout.write(materialize(process.env.FAKE_SSH_STDOUT || ''));
  process.stderr.write(materialize(process.env.FAKE_SSH_STDERR || ''));
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

    expect(evaluatorPackage.scripts?.cli).toBe('node --no-warnings --import tsx src/cli.ts');
    expect(evaluatorPackage.devDependencies?.tsx).toBe('^4.21.0');
    expect({
      setup: rootPackage.scripts?.['eval:intex-agent:setup'],
      preflight: rootPackage.scripts?.['eval:intex-agent:preflight'],
      endpoint: rootPackage.scripts?.['eval:intex-agent:endpoint'],
      full: rootPackage.scripts?.['eval:intex-agent'],
      matrixSmoke: rootPackage.scripts?.['eval:intex-agent:matrix-smoke'],
      matrixCorpus: rootPackage.scripts?.['eval:intex-agent:matrix-corpus'],
    }).toEqual({
      setup: 'node --no-warnings --import tsx tools/intex-agent-evals/src/cli.ts setup',
      preflight: 'node --no-warnings --import tsx tools/intex-agent-evals/src/cli.ts preflight',
      endpoint: 'node --no-warnings --import tsx tools/intex-agent-evals/src/cli.ts endpoint',
      full: 'node --no-warnings --import tsx tools/intex-agent-evals/src/cli.ts',
      matrixSmoke:
        'node --no-warnings --import tsx tools/intex-agent-evals/src/cli.ts matrix-smoke',
      matrixCorpus: 'scripts/run-intex-agent-evals-prod.sh matrix-corpus',
    });
  });

  it('documents only the banner-free canonical root commands and no literal scenario separator', () => {
    const plan = fs.readFileSync(PLAN_PATH, 'utf8');
    const canonicalBlock = `\`\`\`bash
pnpm --silent run eval:intex-agent:setup
pnpm --silent run eval:intex-agent:preflight
pnpm --silent run eval:intex-agent:endpoint
pnpm --silent run eval:intex-agent
pnpm --silent run eval:intex-agent --scenario intex-eval-003
pnpm --silent run eval:intex-agent:matrix-smoke
\`\`\``;

    expect(plan).toContain(canonicalBlock);
    expect(plan).not.toContain('pnpm run eval:intex-agent');
    expect(plan).not.toContain('eval:intex-agent -- --scenario');
  });

  it('runs the exact banner-free setup command without forwarding a pnpm separator', () => {
    const result = spawnSync('pnpm', ['--silent', 'run', 'eval:intex-agent:setup'], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('setup result FAIL SETUP_TTY_REQUIRED\n');
    expect(result.stderr).toBe('');
    expect(`${result.stdout}${result.stderr}`).not.toContain('INVALID_COMMAND');
  });

  it('runs the exact banner-free root scenario command without a literal pnpm separator', () => {
    const result = spawnSync(
      'pnpm',
      ['--silent', 'run', 'eval:intex-agent', '--scenario', 'intex-eval-999'],
      {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
        timeout: 30_000,
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('cli result FAIL INVALID_SCENARIO\n');
    expect(result.stderr).toBe('');
    expect(`${result.stdout}${result.stderr}`).not.toContain('INVALID_COMMAND');
  });

  it('keeps the direct production entry output closed when the CLI returns exit 2', () => {
    const result = spawnSync(
      'node',
      [
        '--no-warnings',
        '--import',
        'tsx',
        'tools/intex-agent-evals/src/cli.ts',
        '--offline-invalid-audit',
      ],
      {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
        timeout: 30_000,
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('cli result FAIL INVALID_COMMAND\n');
    expect(result.stderr).toBe('');
    expect(`${result.stdout}${result.stderr}`).not.toContain(REPOSITORY_ROOT);
    expect(`${result.stdout}${result.stderr}`).not.toContain('tsx src/cli.ts');
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
    {
      label: 'private production matrix corpus extra',
      arguments_: ['__production-matrix-corpus', 'extra-sentinel'],
    },
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
    {
      selector: 'setup',
      arguments_: ['setup'],
      cliArguments: ['setup'],
      tty: '-tt',
      payload: setupPayload(),
    },
    {
      selector: 'preflight',
      arguments_: ['preflight'],
      cliArguments: ['preflight'],
      tty: '-T',
      payload: preflightPayload(),
    },
    {
      selector: 'endpoint',
      arguments_: ['endpoint'],
      cliArguments: ['endpoint'],
      tty: '-T',
      payload: evaluationPayload('endpoint', 0),
    },
    {
      selector: 'full',
      arguments_: ['full'],
      cliArguments: ['full'],
      tty: '-T',
      payload: evaluationPayload('full', 0),
    },
    {
      selector: 'scenario',
      arguments_: ['scenario', 'intex-eval-003'],
      cliArguments: ['scenario', 'intex-eval-003'],
      tty: '-T',
      payload: evaluationPayload('scenario', 0),
    },
    {
      selector: 'matrix-smoke',
      arguments_: ['matrix-smoke'],
      cliArguments: ['matrix-smoke'],
      tty: '-T',
      payload: evaluationPayload('matrix-smoke', 0),
    },
    {
      selector: 'private production matrix-corpus transport',
      arguments_: ['__production-matrix-corpus'],
      cliArguments: ['matrix-corpus'],
      tty: '-T',
      payload: matrixCorpusPayload(0),
    },
    {
      selector: 'private production MiniMax M3 matrix-corpus transport',
      arguments_: ['__production-matrix-corpus', '--agent-model=or:minimax/minimax-m3'],
      cliArguments: ['matrix-corpus', '--agent-model=or:minimax/minimax-m3'],
      tty: '-T',
      payload: matrixCorpusPayload(0),
    },
  ])(
    'accepts the exact $selector selector',
    ({ arguments_, cliArguments, tty, payload }) => {
      const run = runWrapper(arguments_, { sshStdout: framedOutput(payload, 0) });
      const remoteCommand = run.sshCalls[0]?.[6] ?? '';
      const frameId = remoteCommand.match(FRAME_PATTERN)?.[0] ?? '';

      expect(run.result.error).toBeUndefined();
      expect(run.result.status).toBe(0);
      expect(run.result.stdout).toBe(payload);
      expect(run.result.stderr).toBe('');
      expect(frameId).toMatch(/^[a-f0-9]{48}$/u);
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
          expectedRemoteCommand(cliArguments, frameId),
        ],
      ]);
    },
    30_000
  );

  it.each([{ arguments_: ['matrix-corpus'] }, { arguments_: ['matrix-corpus', 'extra-sentinel'] }])(
    'rejects the legacy Home Dev matrix-corpus command before git or ssh',
    ({ arguments_ }) => {
      const run = runWrapper(arguments_);

      expect(run.result.status).toBe(2);
      expect(run.result.stdout).toBe('');
      expect(run.result.stderr).toBe('PRODUCTION_MATRIX_CORPUS_REQUIRED\n');
      expect(run.gitCalls).toEqual([]);
      expect(run.sshCalls).toEqual([]);
    }
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
      const run = runWrapper(['scenario', 'intex-eval-003'], {
        sshStdout: framedOutput(evaluationPayload('scenario', 0), 0),
      });
      const sshArguments = run.sshCalls[0] ?? [];
      const remoteCommand = sshArguments[6] ?? '';
      const frameId = remoteCommand.match(FRAME_PATTERN)?.[0] ?? '';
      const invocation = remoteCommand.slice('exec 3>&1; exec '.length, -' >/dev/null 2>&1'.length);
      const parseResult = spawnSync(
        '/bin/sh',
        ['-fc', `set -- ${invocation}; printf '%s\\0' "$@"`],
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
        expectedRemoteCommand(['scenario', 'intex-eval-003'], frameId),
      ]);
      expect(remoteCommand).toContain('exec 3>&1; exec zsh -lic ');
      expect(remoteCommand).toContain("'\\''remote_environment_unavailable'\\''");
      expect(remoteCommand).toContain('$HOME/deploy/intexuraos');
      expect(remoteCommand).not.toContain(run.localHome);
      expect(remoteCommand).toContain('git rev-parse --verify');
      expect(remoteCommand).toContain('[ "$deployed_sha" != "$required_sha" ]');
      expect(remoteCommand).toContain('git status --porcelain=v1 --untracked-files=all');
      expect(remoteCommand).toContain('command -v direnv >/dev/null 2>&1');
      expect(remoteCommand).toContain('command -v node >/dev/null 2>&1');
      expect(remoteCommand).toContain('direnv exec . true >/dev/null 2>&1');
      expect(remoteCommand).toContain('INTEXURAOS_EVAL_LOCAL_CRITICAL_PATHS_CLEAN=true');
      expect(remoteCommand).toContain('INTEXURAOS_EVAL_REMOTE_CRITICAL_PATHS_CLEAN=true');
      expect(remoteCommand).toContain('>/dev/null 2>&1');
      expect(parseResult.error).toBeUndefined();
      expect(parseResult.status).toBe(0);
      expect(parseResult.stderr).toBe('');
      expect(parseResult.stdout.split('\0').slice(0, -1)).toEqual([
        'zsh',
        '-lic',
        REMOTE_PROGRAM,
        'intex-agent-evals-home-dev',
        frameId,
        VALID_SHA,
        'scenario',
        'intex-eval-003',
      ]);
    }
  );

  it.each([0, 1, 2] as const)(
    'preserves remote status %i and only the validated framed CLI payload',
    (status) => {
      const payload = evaluationPayload('endpoint', status);
      const run = runWrapper(['endpoint'], {
        sshExit: status,
        sshStdout: framedOutput(payload, status),
      });

      expect(run.result.status).toBe(status);
      expect(run.result.stdout).toBe(payload);
      expect(run.result.stderr).toBe('');
    },
    30_000
  );

  it.each([
    {
      label: 'duplicate scenario ordinal',
      payload: matrixCorpusPayload(0).replace(
        'scenario intex-eval-002 PASS',
        'scenario intex-eval-001 PASS'
      ),
    },
    {
      label: 'out-of-order scenario ordinal',
      payload: matrixCorpusPayload(0).replace(
        'scenario intex-eval-002 PASS',
        'scenario intex-eval-003 PASS'
      ),
    },
    {
      label: 'duplicate terminal result',
      payload: matrixCorpusPayload(0).replace(
        'evaluation result PASS exit 0\n',
        'evaluation result PASS exit 0\nevaluation result PASS exit 0\n'
      ),
    },
    {
      label: 'failure code before pass',
      payload: matrixCorpusPayload(0).replace(
        'evaluation result PASS exit 0\n',
        'evaluation failure reply_timeout\nevaluation result PASS exit 0\n'
      ),
    },
  ])('rejects a matrix-corpus payload with $label', ({ payload }) => {
    const run = runWrapper(['__production-matrix-corpus'], {
      sshStdout: framedOutput(payload, 0),
    });

    expect(run.result.status).toBe(2);
    expect(run.result.stdout).toBe('');
    expect(run.result.stderr).toBe('remote_execution_failed\n');
  });

  it('rejects a matrix-corpus failure code outside the allowlist', () => {
    const payload = matrixCorpusPayload(2).replace(
      'evaluation result INFRASTRUCTURE_FAILURE exit 2\n',
      'evaluation failure PRIVATE_TOKEN_ABC123\nevaluation result INFRASTRUCTURE_FAILURE exit 2\n'
    );
    const run = runWrapper(['__production-matrix-corpus'], {
      sshExit: 2,
      sshStdout: framedOutput(payload, 2),
    });

    expect(run.result.status).toBe(2);
    expect(run.result.stdout).toBe('');
    expect(run.result.stderr).toBe('remote_execution_failed\n');
  });

  it.each([
    { count: 100, accepted: true },
    { count: 101, accepted: false },
  ])('enforces the matrix-corpus failure-code limit at $count lines', ({ count, accepted }) => {
    const failureLines = 'evaluation failure reply_timeout\n'.repeat(count);
    const payload = matrixCorpusPayload(2).replace(
      'evaluation result INFRASTRUCTURE_FAILURE exit 2\n',
      `${failureLines}evaluation result INFRASTRUCTURE_FAILURE exit 2\n`
    );
    const run = runWrapper(['__production-matrix-corpus'], {
      sshExit: 2,
      sshStdout: framedOutput(payload, 2),
    });

    expect(run.result.status).toBe(2);
    expect(run.result.stdout).toBe(accepted ? payload : '');
    expect(run.result.stderr).toBe(accepted ? '' : 'remote_execution_failed\n');
  });

  it('preserves a validated matrix-corpus infrastructure failure code', () => {
    const payload = matrixCorpusPayload(2).replace(
      'evaluation result INFRASTRUCTURE_FAILURE exit 2\n',
      'evaluation failure reply_timeout\nevaluation result INFRASTRUCTURE_FAILURE exit 2\n'
    );
    const run = runWrapper(['__production-matrix-corpus'], {
      sshExit: 2,
      sshStdout: framedOutput(payload, 2),
    });

    expect(run.result.status).toBe(2);
    expect(run.result.stdout).toBe(payload);
    expect(run.result.stderr).toBe('');
  });

  it.each([
    'revision_mismatch',
    'remote_environment_unavailable',
    'remote_implementation_paths_dirty',
  ])(
    'preserves the safe remote precheck code %s',
    (code) => {
      const run = runWrapper(['endpoint'], {
        sshExit: 2,
        sshStdout: framedOutput(`${code}\n`, 2),
      });

      expect(run.result.status).toBe(2);
      expect(run.result.stdout).toBe(`${code}\n`);
      expect(run.result.stderr).toBe('');
    },
    30_000
  );

  it.each([
    {
      label: 'before the frame',
      stdout: `${SECRET_SENTINEL} ${GENERIC_PATH_SENTINEL}\n${framedOutput(
        evaluationPayload('endpoint', 0),
        0
      )}`,
    },
    {
      label: 'inside the frame',
      stdout: framedOutput(
        `${evaluationPayload('endpoint', 0)}${SECRET_SENTINEL} ${GENERIC_PATH_SENTINEL}\n`,
        0
      ),
    },
    {
      label: 'after the frame',
      stdout: `${framedOutput(evaluationPayload('endpoint', 0), 0)}${SECRET_SENTINEL} ${GENERIC_PATH_SENTINEL}\n`,
    },
  ])(
    'rejects non-CLI output $label without replaying any captured bytes',
    ({ stdout }) => {
      const run = runWrapper(['endpoint'], { sshStdout: stdout });

      expect(run.result.status).toBe(2);
      expect(run.result.stdout).toBe('');
      expect(run.result.stderr).toBe('remote_execution_failed\n');
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(SECRET_SENTINEL);
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(GENERIC_PATH_SENTINEL);
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain('evaluation run');
    },
    30_000
  );

  it.each([
    {
      label: 'missing begin marker',
      stdout: `${evaluationPayload('endpoint', 0)}__INTEX_AGENT_EVAL_${FRAME_PLACEHOLDER}_END_0__\n`,
    },
    {
      label: 'missing end marker',
      stdout: `__INTEX_AGENT_EVAL_${FRAME_PLACEHOLDER}_BEGIN__\n${evaluationPayload('endpoint', 0)}`,
    },
    {
      label: 'duplicate complete frame',
      stdout: `${framedOutput(evaluationPayload('endpoint', 0), 0)}${framedOutput(
        evaluationPayload('endpoint', 0),
        0
      )}`,
    },
    {
      label: 'status mismatch',
      stdout: framedOutput(evaluationPayload('endpoint', 0), 1),
    },
  ])(
    'requires exactly one complete private frame: $label',
    ({ stdout }) => {
      const run = runWrapper(['endpoint'], { sshStdout: stdout });

      expect(run.result.status).toBe(2);
      expect(run.result.stdout).toBe('');
      expect(run.result.stderr).toBe('remote_execution_failed\n');
    },
    30_000
  );

  it.each([
    {
      label: 'before the frame',
      stdout: `${SECRET_SENTINEL} ${GENERIC_PATH_SENTINEL}\n${framedOutput(setupPayload(), 0)}`,
    },
    {
      label: 'inside the frame',
      stdout: framedOutput(
        `setup input account_alias\n${SECRET_SENTINEL} ${GENERIC_PATH_SENTINEL}\nsetup result PASS created account operator-one\n`,
        0
      ),
    },
    {
      label: 'after the frame',
      stdout: `${framedOutput(setupPayload(), 0)}${SECRET_SENTINEL} ${GENERIC_PATH_SENTINEL}\n`,
    },
  ])(
    'filters setup output and rejects unsafe data $label',
    ({ stdout }) => {
      const run = runWrapper(['setup'], { sshStdout: stdout });

      expect(run.result.status).toBe(2);
      expect(run.result.stderr).toBe('remote_execution_failed\n');
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(SECRET_SENTINEL);
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(GENERIC_PATH_SENTINEL);
    },
    30_000
  );

  it('rejects setup when its safe result contradicts the framed and ssh status', () => {
    const run = runWrapper(['setup'], {
      sshExit: 2,
      sshStdout: framedOutput(setupPayload(), 2),
    });

    expect(run.result.status).toBe(2);
    expect(run.result.stdout).not.toContain('setup result PASS');
    expect(run.result.stderr).toBe('remote_execution_failed\n');
  });

  it.each([0, 1, 2] as const)(
    'normalizes nominal status %i when any non-CLI stderr escapes',
    (status) => {
      const run = runWrapper(['endpoint'], {
        sshExit: status,
        sshStdout: framedOutput(evaluationPayload('endpoint', status), status),
        sshStderr: `${SECRET_SENTINEL} ${GENERIC_PATH_SENTINEL} process diagnostic\n`,
      });

      expect(run.result.status).toBe(2);
      expect(run.result.stdout).toBe('');
      expect(run.result.stderr).toBe('remote_execution_failed\n');
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(SECRET_SENTINEL);
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(GENERIC_PATH_SENTINEL);
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain('evaluation run');
    },
    30_000
  );

  it.each([0, 1, 2])(
    'normalizes nominal status %i when the CLI produces no safe output',
    (status) => {
      const run = runWrapper(['endpoint'], { sshExit: status });

      expect(run.result.status).toBe(2);
      expect(run.result.stdout).toBe('');
      expect(run.result.stderr).toBe('remote_execution_failed\n');
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
        sshStdout: framedOutput(evaluationPayload('endpoint', 0), 0),
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
        sshStdout: framedOutput(evaluationPayload('endpoint', 0), 0),
        sshStderr: 'safe stderr must remain buffered\n',
      });

      expect(run.result.status).toBe(2);
      expect(run.result.stdout).toBe('');
      expect(run.result.stderr).toBe('remote_execution_failed\n');
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(SECRET_SENTINEL);
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain(run.tempRoot);
      expect(`${run.result.stdout}${run.result.stderr}`).not.toContain('evaluation run');
    },
    30_000
  );

  it(
    'does not forward configured secrets or print the command, argv, SHA, or temp path',
    { timeout: 30_000 },
    () => {
      const run = runWrapper(['endpoint'], {
        sshStdout: framedOutput(evaluationPayload('endpoint', 0), 0),
      });
      const serializedSshArguments = JSON.stringify(run.sshCalls);
      const output = `${run.result.stdout}${run.result.stderr}`;

      expect(run.result.status).toBe(0);
      expect(serializedSshArguments).not.toContain(SECRET_SENTINEL);
      expect(output).toBe(evaluationPayload('endpoint', 0));
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
      const run = runWrapper(['endpoint'], {
        sshStdout: framedOutput(evaluationPayload('endpoint', 0), 0),
      });

      expect(run.result.status).toBe(0);
      expect(run.sshSensitiveEnvironment).toEqual([[]]);
    }
  );

  it(
    'disables ssh_config SendEnv forwarding for generic inherited path and token values',
    { timeout: 30_000 },
    () => {
      const run = runWrapper(['endpoint'], {
        sshStdout: framedOutput(evaluationPayload('endpoint', 0), 0),
      });
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
