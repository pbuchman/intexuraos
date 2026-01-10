#!/usr/bin/env node
/**
 * Verify Workspace Tracked Wrapper
 *
 * Runs targeted verification for a workspace and tracks failures to
 * .claude/ci-failures/{project}-{branch}.jsonl
 *
 * Usage: node scripts/verify-workspace-tracked.mjs <workspace-name>
 */

import { spawn, execSync } from 'node:child_process';
import { resolve, dirname, basename } from 'node:path';
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';

const repoRoot = resolve(import.meta.dirname, '..');
const failuresDir = resolve(repoRoot, '.claude/ci-failures');

function getProjectName() {
  return basename(repoRoot);
}

function getCurrentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getLogFileName(project, branch) {
  return `${sanitizeName(project)}-${sanitizeName(branch)}.jsonl`;
}

function getRunNumber(project, branch) {
  const filePath = resolve(failuresDir, getLogFileName(project, branch));
  if (!existsSync(filePath)) return 1;

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  let maxRun = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.runNumber > maxRun) maxRun = entry.runNumber;
    } catch {
      // Skip malformed JSONL lines
    }
  }

  return maxRun + 1;
}

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

function getCodeSnippet(filePath, line, contextLines = 2) {
  try {
    const fullPath = resolve(repoRoot, filePath);
    if (!existsSync(fullPath)) return null;

    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const lineIndex = line - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) return null;

    const start = Math.max(0, lineIndex - contextLines);
    const end = Math.min(lines.length - 1, lineIndex + contextLines);

    const snippet = lines
      .slice(start, end + 1)
      .map((l, i) => {
        const lineNum = start + i + 1;
        const marker = lineNum === line ? '>' : ' ';
        return `${marker}${lineNum}: ${l}`;
      })
      .join('\n');

    return {
      targetLine: lines[lineIndex]?.trim() ?? null,
      context: snippet,
    };
  } catch {
    return null;
  }
}

function parseTypeScriptErrors(output) {
  const failures = [];
  const clean = stripAnsi(output);

  const patterns = [
    /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/gm,
    /^(.+?):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.+)$/gm,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(clean)) !== null) {
      const [, file, lineStr, , code, message] = match;
      const line = parseInt(lineStr, 10);
      const snippetData = getCodeSnippet(file, line);

      failures.push({
        type: 'typecheck',
        code,
        file,
        line,
        message: message.trim(),
        snippet: snippetData?.targetLine ?? null,
        context: snippetData?.context ?? null,
      });
    }
  }

  return failures;
}

function parseESLintErrors(output) {
  const failures = [];
  const clean = stripAnsi(output);

  let currentFile = null;
  const lines = clean.split('\n');

  for (const line of lines) {
    const fileMatch = line.match(/^(\/[^\s]+\.(?:ts|tsx|js|jsx|mjs|cjs))$/);
    if (fileMatch) {
      currentFile = fileMatch[1].replace(repoRoot + '/', '');
      continue;
    }

    const errorMatch = line.match(/^\s+(\d+):(\d+)\s+error\s+(.+?)\s{2,}(@?[\w/-]+)$/);
    if (errorMatch && currentFile) {
      const [, lineStr, , message, rule] = errorMatch;
      const lineNum = parseInt(lineStr, 10);
      const snippetData = getCodeSnippet(currentFile, lineNum);

      failures.push({
        type: 'lint',
        code: rule,
        file: currentFile,
        line: lineNum,
        message: message.trim(),
        snippet: snippetData?.targetLine ?? null,
        context: snippetData?.context ?? null,
      });
    }
  }

  return failures;
}

function parseTestErrors(output) {
  const failures = [];
  const clean = stripAnsi(output);

  const failPattern = /FAIL\s+(.+?\.test\.ts)\s*>\s*(.+)/g;

  let match;
  while ((match = failPattern.exec(clean)) !== null) {
    const [, file, testPath] = match;

    failures.push({
      type: 'test',
      code: 'TEST_FAIL',
      file,
      line: 0,
      message: testPath.trim(),
      snippet: null,
      context: null,
    });
  }

  return failures;
}

function parseCoverageErrors(output) {
  const failures = [];
  const clean = stripAnsi(output);

  const coveragePattern =
    /ERROR: Coverage for (\w+) \(([\d.]+)%\) does not meet.*threshold \((\d+)%\)/g;

  let match;
  while ((match = coveragePattern.exec(clean)) !== null) {
    const [, metric, actual, threshold] = match;

    failures.push({
      type: 'coverage',
      code: 'COVERAGE_THRESHOLD',
      file: 'vitest.config.ts',
      line: 0,
      message: `${metric}: ${actual}% < ${threshold}%`,
      snippet: null,
      context: null,
    });
  }

  return failures;
}

function parseAllFailures(output) {
  const failures = [
    ...parseTypeScriptErrors(output),
    ...parseESLintErrors(output),
    ...parseTestErrors(output),
    ...parseCoverageErrors(output),
  ];

  const seen = new Set();
  return failures.filter((f) => {
    const key = `${f.type}:${f.file}:${f.line}:${f.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function saveFailures(project, branch, workspace, runNumber, passed, durationMs, failures) {
  if (!existsSync(failuresDir)) {
    mkdirSync(failuresDir, { recursive: true });
  }

  const entry = {
    ts: new Date().toISOString(),
    project,
    branch,
    workspace,
    runNumber,
    passed,
    durationMs,
    failureCount: failures.length,
    failures,
  };

  const filePath = resolve(failuresDir, getLogFileName(project, branch));
  appendFileSync(filePath, JSON.stringify(entry) + '\n');

  return filePath;
}

async function runVerifyWorkspace(workspace) {
  return new Promise((resolvePromise) => {
    const startTime = Date.now();
    let output = '';

    const proc = spawn('./scripts/verify-workspace.sh', [workspace], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    proc.stdout.on('data', (data) => {
      const str = data.toString();
      process.stdout.write(str);
      output += str;
    });

    proc.stderr.on('data', (data) => {
      const str = data.toString();
      process.stderr.write(str);
      output += str;
    });

    proc.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      resolvePromise({ code: code ?? 1, output, durationMs });
    });
  });
}

(async () => {
  const workspace = process.argv[2];

  if (!workspace) {
    console.error('Usage: node scripts/verify-workspace-tracked.mjs <workspace-name>');
    console.error('Example: node scripts/verify-workspace-tracked.mjs llm-orchestrator');
    process.exit(1);
  }

  const project = getProjectName();
  const branch = getCurrentBranch();
  const runNumber = getRunNumber(project, branch);

  console.log(
    `\n📊 Workspace Verification #${runNumber} for ${workspace} on ${project}/${branch}\n`
  );

  const { code, output, durationMs } = await runVerifyWorkspace(workspace);
  const passed = code === 0;
  const failures = passed ? [] : parseAllFailures(output);

  const filePath = saveFailures(
    project,
    branch,
    workspace,
    runNumber,
    passed,
    durationMs,
    failures
  );

  if (!passed && failures.length > 0) {
    console.log(`\n📊 Tracked ${failures.length} failure(s) → ${filePath}`);
    console.log(`   Run 'npm run ci:report' to see aggregated failure stats\n`);
  } else if (!passed) {
    console.log(`\n📊 Verification failed but no parseable errors found → ${filePath}\n`);
  }

  process.exit(code);
})();
