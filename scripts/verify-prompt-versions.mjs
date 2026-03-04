#!/usr/bin/env node
/**
 * Prompt Version Verification Script.
 *
 * Two checks:
 * A) All PromptBuilder objects have a valid semver `version` field.
 * B) When prompt file content changes vs base branch, version must be bumped.
 *
 * Usage:
 *   node scripts/verify-prompt-versions.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;
const VERSION_LINE_REGEX = /^\s*version:\s*['"](\d+\.\d+\.\d+)['"]/;
// Matches concrete PromptBuilder variable declarations, not interface definitions or JSDoc
const PROMPT_BUILDER_REGEX = /(?:export\s+)?(?:const|let)\s+\w+\s*:\s*PromptBuilder</;

const errors = [];

/**
 * Recursively find TypeScript source files (not tests, not dist).
 */
function findTsFiles(dir, files = []) {
  if (!existsSync(dir)) {
    return files;
  }

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (
      stat.isDirectory() &&
      entry !== 'node_modules' &&
      entry !== 'dist' &&
      entry !== '__tests__'
    ) {
      findTsFiles(fullPath, files);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Check if a file contains a PromptBuilder typed export (not in comments).
 */
function hasPromptBuilderExport(content) {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comment lines (JSDoc, single-line, block)
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }
    if (PROMPT_BUILDER_REGEX.test(line)) {
      return true;
    }
  }
  return false;
}

/**
 * Extract version values from file content.
 * Returns array of { version, line } objects.
 */
function extractVersions(content) {
  const versions = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = VERSION_LINE_REGEX.exec(lines[i]);
    if (match?.[1] !== undefined) {
      versions.push({ version: match[1], line: i + 1 });
    }
  }

  return versions;
}

/**
 * Count how many PromptBuilder typed exports exist in a file.
 */
function countPromptBuilderExports(content) {
  let count = 0;
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }
    const matches = line.match(/(?:export\s+)?(?:const|let)\s+\w+\s*:\s*PromptBuilder</g);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

/**
 * Check A: All PromptBuilder objects have valid semver version fields.
 */
function checkVersionFieldsExist(promptFiles) {
  console.log('Check A: Version fields exist and are valid semver\n');

  let checked = 0;

  for (const filePath of promptFiles) {
    const content = readFileSync(filePath, 'utf8');
    const relPath = relative(repoRoot, filePath);
    const expectedCount = countPromptBuilderExports(content);
    const versions = extractVersions(content);

    checked++;

    if (versions.length < expectedCount) {
      errors.push({
        file: relPath,
        message: `Expected ${String(expectedCount)} version field(s) but found ${String(versions.length)}`,
        check: 'A',
      });
      continue;
    }

    for (const { version, line } of versions) {
      if (!SEMVER_REGEX.test(version)) {
        errors.push({
          file: relPath,
          line,
          message: `Invalid version "${version}" — must be MAJOR.MINOR.PATCH`,
          check: 'A',
        });
      }
    }

    console.log(`  ✓ ${relPath} (${versions.map((v) => v.version).join(', ')})`);
  }

  console.log(`\n  Checked ${String(checked)} prompt file(s)\n`);
}

/**
 * Try to get base branch ref for git-diff comparison.
 * Returns null if not available (local dev without remote).
 */
function getBaseBranch() {
  try {
    execSync('git rev-parse --verify origin/development', {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    return 'origin/development';
  } catch {
    return null;
  }
}

/**
 * Get file content from a git ref. Returns null if file doesn't exist at that ref.
 */
function getFileAtRef(filePath, ref) {
  try {
    const relPath = relative(repoRoot, filePath);
    return execSync(`git show ${ref}:${relPath}`, {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

/**
 * Get list of changed files vs base branch.
 */
function getChangedFiles(baseBranch) {
  try {
    const output = execSync(`git diff --name-only ${baseBranch}...HEAD`, {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((f) => resolve(repoRoot, f));
  } catch {
    // Also check staged + unstaged changes (for uncommitted work)
    try {
      const output = execSync(`git diff --name-only ${baseBranch}`, {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((f) => resolve(repoRoot, f));
    } catch {
      return [];
    }
  }
}

/**
 * Remove version lines from content for comparison.
 */
function stripVersionLines(content) {
  return content
    .split('\n')
    .filter((line) => !VERSION_LINE_REGEX.test(line))
    .join('\n');
}

/**
 * Check B: Version bumped when prompt content changes.
 */
function checkVersionBumped(promptFiles) {
  const baseBranch = getBaseBranch();

  if (baseBranch === null) {
    console.log('Check B: Skipped (no origin/development available)\n');
    return;
  }

  console.log(`Check B: Version bumped when content changed (vs ${baseBranch})\n`);

  const changedFiles = new Set(getChangedFiles(baseBranch));
  let checked = 0;

  for (const filePath of promptFiles) {
    if (!changedFiles.has(filePath)) {
      continue;
    }

    checked++;
    const relPath = relative(repoRoot, filePath);
    const currentContent = readFileSync(filePath, 'utf8');
    const baseContent = getFileAtRef(filePath, baseBranch);

    // New file — no base version to compare against
    if (baseContent === null) {
      console.log(`  ✓ ${relPath} (new file)`);
      continue;
    }

    // Compare content excluding version lines
    const currentStripped = stripVersionLines(currentContent);
    const baseStripped = stripVersionLines(baseContent);

    if (currentStripped === baseStripped) {
      console.log(`  ✓ ${relPath} (no content change)`);
      continue;
    }

    // Content changed — version must differ
    const currentVersions = extractVersions(currentContent);
    const baseVersions = extractVersions(baseContent);

    const currentVersionStr = currentVersions.map((v) => v.version).join(',');
    const baseVersionStr = baseVersions.map((v) => v.version).join(',');

    if (currentVersionStr === baseVersionStr) {
      errors.push({
        file: relPath,
        message: `Content changed but version was not bumped (still ${currentVersionStr}).
    Prompt versioning follows semver:
      MAJOR for behavior changes, MINOR for refinements, PATCH for typos.
    See docs/patterns/prompt-versioning.md`,
        check: 'B',
      });
    } else {
      console.log(`  ✓ ${relPath} (${baseVersionStr} → ${currentVersionStr})`);
    }
  }

  if (checked === 0) {
    console.log('  No prompt files changed\n');
  } else {
    console.log(`\n  Checked ${String(checked)} changed prompt file(s)\n`);
  }
}

/**
 * Find all files containing PromptBuilder exports.
 */
function findPromptFiles() {
  const searchDirs = [
    join(repoRoot, 'packages/llm-prompts/src'),
    join(repoRoot, 'apps'),
    join(repoRoot, 'workers'),
  ];

  const promptFiles = [];

  for (const dir of searchDirs) {
    const tsFiles = findTsFiles(dir);
    for (const filePath of tsFiles) {
      const content = readFileSync(filePath, 'utf8');
      if (hasPromptBuilderExport(content)) {
        promptFiles.push(filePath);
      }
    }
  }

  return promptFiles;
}

/**
 * Main verification function.
 */
function main() {
  console.log('Verifying prompt versions...\n');

  const promptFiles = findPromptFiles();

  if (promptFiles.length === 0) {
    console.log('No PromptBuilder files found');
    process.exit(1);
  }

  console.log(`Found ${String(promptFiles.length)} prompt file(s)\n`);

  checkVersionFieldsExist(promptFiles);
  checkVersionBumped(promptFiles);

  if (errors.length > 0) {
    const checkAErrors = errors.filter((e) => e.check === 'A');
    const checkBErrors = errors.filter((e) => e.check === 'B');

    console.log('Violations found:\n');

    if (checkAErrors.length > 0) {
      console.log(`── Missing/invalid version fields (${String(checkAErrors.length)}) ──\n`);
      for (const error of checkAErrors) {
        console.log(
          `  FAIL: ${error.file}${error.line !== undefined ? `:${String(error.line)}` : ''}`
        );
        console.log(`    ${error.message}\n`);
      }
    }

    if (checkBErrors.length > 0) {
      console.log(`── Version not bumped (${String(checkBErrors.length)}) ──\n`);
      for (const error of checkBErrors) {
        console.log(`  FAIL: ${error.file}`);
        console.log(`    ${error.message}\n`);
      }
    }

    console.log(`Prompt version verification failed with ${String(errors.length)} violation(s).`);
    console.log('');
    console.log('Documentation: docs/patterns/prompt-versioning.md');
    process.exit(1);
  }

  console.log('✓ All prompt versions are valid and up to date');
}

main();
