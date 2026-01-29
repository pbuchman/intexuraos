#!/usr/bin/env node
/**
 * Reply.send() Verification Script.
 *
 * Ensures all HTTP responses use reply.ok() or reply.fail() instead of raw reply.send().
 * This enforces the standard response contract: { success: true, data: T } for success,
 * { success: false, error: { code, message } } for errors.
 *
 * Exceptions:
 * - reply.status(204).send() - HTTP spec (No Content)
 * - Lines with @allow-raw-send comment - documented exceptions
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
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Check a single service for reply.send() violations.
 */
function checkService(serviceName, serviceDir) {
  const srcDir = join(serviceDir, 'src');

  if (!existsSync(srcDir)) {
    return;
  }

  const tsFiles = findTsFiles(srcDir);

  for (const filePath of tsFiles) {
    const content = readFileSync(filePath, 'utf8');
    const violations = findReplySendViolations(content, filePath);

    for (const v of violations) {
      errors.push(v);
    }
  }
}

/**
 * Main verification function.
 */
function main() {
  console.log('Verifying response contract (no raw reply.send())...\n');

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
    console.log('Violations found:');
    console.log('');
    for (const error of errors) {
      console.log(`  ${error.file}:${String(error.line)}`);
      console.log(`    ${error.content}`);
      console.log('');
    }
    console.log(
      `Response contract verification failed with ${String(errors.length)} violation(s).`
    );
    console.log('');
    console.log('To fix:');
    console.log('  - Use reply.ok(data) instead of reply.send({ success: true, data })');
    console.log('  - Use reply.fail(code, message) instead of reply.status(4xx).send({ error })');
    console.log('  - Or add // @allow-raw-send: <reason> on the line above for valid exceptions');
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
