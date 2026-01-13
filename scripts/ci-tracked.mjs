#!/usr/bin/env node
/**
 * CI Tracked Wrapper
 *
 * Runs CI and tracks failures to .claude/ci-failures/{project}-{branch}.jsonl
 * - Append-only: never overwrites previous runs
 * - Captures first-run failures for LLM learning
 * - Extracts code snippets for pattern recognition
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
      // Skip malformed JSONL lines - corrupted entries shouldn't break tracking
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
    // File may not exist or be readable - return null to skip snippet
    return null;
  }
}

function parseTypeScriptErrors(output) {
  const failures = [];
  const clean = stripAnsi(output);

  // Match patterns like: src/file.ts(10,5): error TS2322: message
  // Or: src/file.ts:10:5 - error TS2322: message
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

  // ESLint output format:
  // /path/to/file.ts
  //   10:5  error  Message  rule-name
  const filePattern = /^(\/[^\s]+\.(?:ts|tsx|js|jsx|mjs|cjs))$/gm;
  const errorPattern = /^\s+(\d+):(\d+)\s+error\s+(.+?)\s{2,}(@?[\w/-]+)$/gm;

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

  // Vitest failure pattern: FAIL  path/to/test.ts > describe > test name
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

function parseBuildErrors(output) {
  const failures = [];
  const clean = stripAnsi(output);

  // esbuild errors: ✘ [ERROR] message
  const errorPattern = /✘\s*\[ERROR\]\s*(.+?)(?:\n|$)/g;

  let match;
  while ((match = errorPattern.exec(clean)) !== null) {
    failures.push({
      type: 'build',
      code: 'BUILD_ERROR',
      file: 'unknown',
      line: 0,
      message: match[1].trim(),
      snippet: null,
      context: null,
    });
  }

  return failures;
}

function parseVerifyErrors(output) {
  const failures = [];
  const clean = stripAnsi(output);

  // Look for common verify script failure patterns
  // ❌ or ✗ followed by message
  const errorPattern = /[❌✗]\s*(.+?)(?:\n|$)/g;

  let match;
  while ((match = errorPattern.exec(clean)) !== null) {
    failures.push({
      type: 'verify',
      code: 'VERIFY_FAIL',
      file: 'unknown',
      line: 0,
      message: match[1].trim(),
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
    ...parseBuildErrors(output),
    ...parseVerifyErrors(output),
  ];

  // Deduplicate by file+line+code
  const seen = new Set();
  return failures.filter((f) => {
    const key = `${f.type}:${f.file}:${f.line}:${f.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function saveFailures(project, branch, runNumber, passed, durationMs, failures) {
  if (!existsSync(failuresDir)) {
    mkdirSync(failuresDir, { recursive: true });
  }

  const entry = {
    ts: new Date().toISOString(),
    project,
    branch,
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

async function runCI() {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let output = '';

    const proc = spawn('node', ['scripts/ci.mjs'], {
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
      resolve({ code: code ?? 1, output, durationMs });
    });
  });
}

(async () => {
  const project = getProjectName();
  const branch = getCurrentBranch();
  const runNumber = getRunNumber(project, branch);

  console.log(`\n📊 CI Run #${runNumber} on ${project}/${branch}\n`);

  const { code, output, durationMs } = await runCI();
  const passed = code === 0;
  const failures = passed ? [] : parseAllFailures(output);

  const filePath = saveFailures(project, branch, runNumber, passed, durationMs, failures);

  if (!passed && failures.length > 0) {
    console.log(`\n📊 Tracked ${failures.length} failure(s) → ${filePath}`);
    console.log(`   Run 'pnpm run ci:report' to see aggregated failure stats\n`);
  } else if (!passed) {
    console.log(`\n📊 CI failed but no parseable errors found → ${filePath}\n`);
  }

  process.exit(code);
})();
