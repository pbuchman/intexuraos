#!/usr/bin/env node
/**
 * Response Contract Verification Script.
 *
 * Ensures all HTTP responses use reply.ok() or reply.fail() instead of:
 * 1. Raw reply.send() calls
 * 2. Raw return statements with { error: ... } or { success: true, ... }
 *
 * This enforces the standard response contract: { success: true, data: T } for success,
 * { success: false, error: { code, message } } for errors.
 *
 * Exceptions:
 * - reply.status(204).send() - HTTP spec (No Content)
 * - Lines with @allow-raw-send comment - documented exceptions for send()
 * - Lines with @allow-raw-return comment - documented exceptions for raw returns
 *
 * Usage:
 *   node scripts/verify-reply-send.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appsDir = join(repoRoot, 'apps');

const errors = [];

/**
 * Find all TypeScript files in a directory recursively.
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
 * Check if a line has the @allow-raw-send escape hatch on the preceding line.
 */
function hasAllowRawSendComment(lines, lineIndex) {
  if (lineIndex === 0) {
    return false;
  }
  const prevLine = lines[lineIndex - 1].trim();
  return prevLine.includes('@allow-raw-send');
}

/**
 * Check if a line has the @allow-raw-return escape hatch on the preceding line.
 */
function hasAllowRawReturnComment(lines, lineIndex) {
  if (lineIndex === 0) {
    return false;
  }
  const prevLine = lines[lineIndex - 1].trim();
  return prevLine.includes('@allow-raw-return');
}

/**
 * Check if a send() call is allowed (204 status, empty send, or has escape hatch).
 */
function isAllowedSend(line, lines, lineIndex) {
  const trimmed = line.trim();

  // Allow reply.status(204).send() - HTTP spec for No Content
  if (/\.status\s*\(\s*204\s*\)\.send\s*\(/.test(trimmed)) {
    return true;
  }

  // Allow reply.send() with no arguments (empty body, typically used with 204)
  if (/\.send\s*\(\s*\)/.test(trimmed)) {
    return true;
  }

  // Allow if preceded by @allow-raw-send comment
  if (hasAllowRawSendComment(lines, lineIndex)) {
    return true;
  }

  // Check if preceded by reply.status(204) on previous lines (within 3 lines)
  for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 3); i--) {
    const prevLine = lines[i].trim();
    if (/reply\.status\s*\(\s*204\s*\)/.test(prevLine)) {
      return true;
    }
    // Stop searching if we hit another statement
    if (prevLine.endsWith(';') && !prevLine.includes('status')) {
      break;
    }
  }

  return false;
}

/**
 * Check if a raw return is allowed (has escape hatch or is followed by reply.ok/fail).
 */
function isAllowedRawReturn(line, lines, lineIndex) {
  // Allow if preceded by @allow-raw-return comment
  if (hasAllowRawReturnComment(lines, lineIndex)) {
    return true;
  }

  // Check if this return is actually part of reply.ok() or reply.fail() call
  // e.g., "return reply.ok(...)" or "return await reply.ok(...)"
  const trimmed = line.trim();
  if (/return\s+(await\s+)?reply\.(ok|fail)\s*\(/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Find reply.send() violations in a file.
 */
function findReplySendViolations(content, filePath) {
  const violations = [];
  const lines = content.split('\n');

  // Patterns for raw reply.send():
  // 1. reply.send( - direct send
  // 2. reply.status(...).send( - status then send (except 204)
  const sendPatterns = [/reply\.send\s*\(/, /reply\.status\s*\([^)]+\)\.send\s*\(/];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    const trimmed = line.trim();

    // Skip comment lines
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Check each pattern
    for (const pattern of sendPatterns) {
      if (pattern.test(line)) {
        if (!isAllowedSend(line, lines, i)) {
          violations.push({
            file: relative(repoRoot, filePath),
            line: lineNumber,
            content: trimmed.length > 80 ? trimmed.slice(0, 77) + '...' : trimmed,
            type: 'raw-send',
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Find raw return violations in route files.
 * Detects: return { error: ... } and return { success: true, ... }
 */
function findRawReturnViolations(content, filePath) {
  const violations = [];
  const lines = content.split('\n');

  // Patterns for raw returns that should use reply.ok() or reply.fail():
  // 1. return { error: - should use reply.fail()
  // 2. return { success: true - should use reply.ok()
  // 3. return {\n  error: - multiline variant
  // 4. return {\n  success: true - multiline variant
  const rawReturnPatterns = [
    { pattern: /return\s*\{\s*error\s*:/, fix: 'reply.fail()' },
    { pattern: /return\s*\{\s*success\s*:\s*true/, fix: 'reply.ok()' },
    { pattern: /return\s*\{\s*success\s*:\s*false/, fix: 'reply.fail()' },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    const trimmed = line.trim();

    // Skip comment lines
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Check single-line patterns
    for (const { pattern, fix } of rawReturnPatterns) {
      if (pattern.test(line)) {
        if (!isAllowedRawReturn(line, lines, i)) {
          violations.push({
            file: relative(repoRoot, filePath),
            line: lineNumber,
            content: trimmed.length > 80 ? trimmed.slice(0, 77) + '...' : trimmed,
            type: 'raw-return',
            fix,
          });
        }
      }
    }

    // Check for multiline patterns: "return {" followed by "error:" or "success: true"
    if (/return\s*\{\s*$/.test(trimmed) && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      if (/^error\s*:/.test(nextLine)) {
        if (!isAllowedRawReturn(line, lines, i)) {
          violations.push({
            file: relative(repoRoot, filePath),
            line: lineNumber,
            content: `${trimmed} ${nextLine}`.slice(0, 77) + '...',
            type: 'raw-return',
            fix: 'reply.fail()',
          });
        }
      } else if (/^success\s*:\s*true/.test(nextLine)) {
        if (!isAllowedRawReturn(line, lines, i)) {
          violations.push({
            file: relative(repoRoot, filePath),
            line: lineNumber,
            content: `${trimmed} ${nextLine}`.slice(0, 77) + '...',
            type: 'raw-return',
            fix: 'reply.ok()',
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Check if a file is a route file.
 */
function isRouteFile(filePath) {
  return filePath.includes('/routes/') && filePath.endsWith('.ts');
}

/**
 * Check a single service for response contract violations.
 */
function checkService(serviceName, serviceDir) {
  const srcDir = join(serviceDir, 'src');

  if (!existsSync(srcDir)) {
    return;
  }

  const tsFiles = findTsFiles(srcDir);

  for (const filePath of tsFiles) {
    const content = readFileSync(filePath, 'utf8');

    // Check for reply.send() violations in all files
    const sendViolations = findReplySendViolations(content, filePath);
    for (const v of sendViolations) {
      errors.push(v);
    }

    // Check for raw return violations only in route files
    if (isRouteFile(filePath)) {
      const returnViolations = findRawReturnViolations(content, filePath);
      for (const v of returnViolations) {
        errors.push(v);
      }
    }
  }
}

/**
 * Main verification function.
 */
function main() {
  console.log('Verifying response contract...\n');

  if (!existsSync(appsDir)) {
    console.log('No apps directory found');
    process.exit(1);
  }

  const services = readdirSync(appsDir).filter((entry) =>
    statSync(join(appsDir, entry)).isDirectory()
  );

  for (const service of services) {
    const serviceDir = join(appsDir, service);
    console.log(`  Checking ${service}/...`);
    checkService(service, serviceDir);
  }

  console.log('');

  if (errors.length > 0) {
    // Group by type for clearer output
    const sendViolations = errors.filter((e) => e.type === 'raw-send');
    const returnViolations = errors.filter((e) => e.type === 'raw-return');

    console.log('Violations found:\n');

    if (sendViolations.length > 0) {
      console.log(`── Raw reply.send() violations (${String(sendViolations.length)}) ──\n`);
      for (const error of sendViolations) {
        console.log(`  ${error.file}:${String(error.line)}`);
        console.log(`    ${error.content}`);
        console.log('');
      }
    }

    if (returnViolations.length > 0) {
      console.log(`── Raw return violations (${String(returnViolations.length)}) ──\n`);
      for (const error of returnViolations) {
        console.log(`  ${error.file}:${String(error.line)}`);
        console.log(`    ${error.content}`);
        console.log(`    Fix: Use ${error.fix}`);
        console.log('');
      }
    }

    console.log(
      `Response contract verification failed with ${String(errors.length)} violation(s).`
    );
    console.log('');
    console.log('To fix:');
    console.log('  - Use reply.ok(data) instead of return { success: true, data }');
    console.log('  - Use reply.fail(code, message) instead of return { error: ... }');
    console.log('  - Or add // @allow-raw-return: <reason> on the line above for valid exceptions');
    console.log('');
    console.log('Valid exceptions:');
    console.log('  - reply.status(204).send() - HTTP No Content (auto-allowed)');
    console.log('  - External webhook contracts requiring specific response formats');
    console.log('  - OAuth/OpenID spec compliance');
    console.log('');
    console.log('Documentation: docs/patterns/response-contract.md');
    process.exit(1);
  }

  console.log('✓ All HTTP responses use the standard response contract');
}

main();
