#!/usr/bin/env node

// Migration Script: Convert unreachable/*.md files to inline v8 ignore comments
//
// This script reads all .claude/skills/coverage/unreachable/*.md files and
// converts them to inline v8 ignore comments.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');

const CATEGORY_MAP = {
  'TypeScript Type System Guarantees': 'ts-type',
  'Type System Constraints': 'ts-type',
  'Firestore Contract Guarantees': 'ts-type',
  'Schema Validation Guarantees': 'schema',
  'Schema Validation': 'schema',
  'Auth Guards': 'auth-guard',
  'Upstream Guards': 'upstream',
  'Use Case Contract': 'test-infra',
  'Non-Critical Error Handling': 'test-infra',
  'Generic Error Path': 'test-infra',
  'Code Logic Redundancy': 'upstream',
  'Single-Threaded Testing': 'test-infra',
  'Security Testing Scenarios': 'test-infra',
  'External API Specific Error States': 'test-infra',
  'Source Map Alignment Issues': 'source-map',
  'Interface Definition': 'module-init',
  'Module State': 'module-init',
  'Test Infrastructure Constraints': 'test-infra',
  // Categories to REJECT (write test instead)
  'Testable but edge case': null,
  'Precondition Violation': null,
};

// ============================================================================
// MARKDOWN PARSER
// ============================================================================

function parseUnreachableMarkdown(content) {
  const exemptions = [];
  const lines = content.split('\n');

  let currentFile = null;
  let currentLine = null;
  let currentBlocker = null;
  let currentProof = null;
  let inCodeBlock = false;
  let codeSnippet = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Section header: ## `path/to/file.ts`
    if (line.startsWith('## `') && line.endsWith('`')) {
      // Save previous exemption if exists
      if (currentFile && currentLine && currentBlocker && currentProof) {
        exemptions.push({
          filePath: currentFile,
          line: currentLine,
          oldCategory: currentBlocker,
          proof: currentProof,
          codeSnippet: codeSnippet.join('\n'),
        });
      }

      // Start new exemption
      currentFile = line.slice(4, -1);
      currentLine = null;
      currentBlocker = null;
      currentProof = null;
      codeSnippet = [];
      inCodeBlock = false;
      continue;
    }

    // Line header: ### Line ~XX: <description>
    const lineMatch = line.match(/###\s+Line\s+~?(\d+):/);
    if (lineMatch) {
      // Save previous exemption if exists
      if (currentFile && currentLine && currentBlocker && currentProof) {
        exemptions.push({
          filePath: currentFile,
          line: currentLine,
          oldCategory: currentBlocker,
          proof: currentProof,
          codeSnippet: codeSnippet.join('\n'),
        });
      }

      currentLine = parseInt(lineMatch[1], 10);
      currentBlocker = null;
      currentProof = null;
      codeSnippet = [];
      inCodeBlock = false;
      continue;
    }

    // Blocker: - **Blocker:** <name>
    const blockerMatch = line.match(/\*\*Blocker:\*\*\s*(.+)/);
    if (blockerMatch) {
      currentBlocker = blockerMatch[1].trim();
      continue;
    }

    // Proof: - **Proof:** <text>
    const proofMatch = line.match(/\*\*Proof:\*\*\s*(.+)/);
    if (proofMatch) {
      currentProof = proofMatch[1].trim();
      continue;
    }

    // Code block
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      codeSnippet.push(line);
    }
  }

  // Don't forget the last exemption
  if (currentFile && currentLine && currentBlocker && currentProof) {
    exemptions.push({
      filePath: currentFile,
      line: currentLine,
      oldCategory: currentBlocker,
      proof: currentProof,
      codeSnippet: codeSnippet.join('\n'),
    });
  }

  return exemptions;
}

// ============================================================================
// CODE LOCATION FINDER
// ============================================================================

function findCodeLocation(filePath, lineHint) {
  // Try to read the file
  const fullPath = resolve(ROOT_DIR, filePath);
  if (!existsSync(fullPath)) {
    return null;
  }

  const content = readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');

  // The lineHint is approximate (~84), search around it
  // Check if the line contains something interesting
  if (lineHint > 0 && lineHint <= lines.length) {
    const searchLine = lines[lineHint - 1];
    // Skip if it's already a comment
    if (searchLine.includes('// istanbul ignore') || searchLine.includes('/* v8 ignore')) {
      return lineHint;
    }
    // Skip if it's just whitespace
    if (searchLine.trim() === '') {
      // Look for the next non-empty line
      for (let i = lineHint; i < lines.length && i < lineHint + 5; i++) {
        if (lines[i].trim() !== '' && !lines[i].trim().startsWith('//')) {
          return i + 1;
        }
      }
    }
    return lineHint;
  }

  return null;
}

// ============================================================================
// COMMENT INSERTER
// ============================================================================

function insertV8IgnoreComment(filePath, line, category, reason) {
  const fullPath = resolve(ROOT_DIR, filePath);
  const content = readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');

  // Insert comment before the specified line (line is 1-indexed)
  const insertIndex = line - 1;

  // Check if comment already exists nearby
  for (let i = Math.max(0, insertIndex - 3); i < Math.min(lines.length, insertIndex + 3); i++) {
    if (lines[i].includes('/* v8 ignore')) {
      console.log(`      (Comment already exists at line ${i + 1}, skipping)`);
      return;
    }
  }

  // Format the comment
  const comment = `/* v8 ignore ${category} -- ${reason} */`;

  // Insert the comment
  lines.splice(insertIndex, 0, comment);

  // Write back
  writeFileSync(fullPath, lines.join('\n') + '\n');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const unreachableDir = resolve(ROOT_DIR, '.claude/skills/coverage/unreachable');

  if (!existsSync(unreachableDir)) {
    console.log('No unreachable/ directory found. Nothing to migrate.');
    process.exit(0);
  }

  const mdFiles = readdirSync(unreachableDir).filter((f) => f.endsWith('.md') && f !== '.gitkeep');

  if (mdFiles.length === 0) {
    console.log('No unreachable/*.md files found. Nothing to migrate.');
    process.exit(0);
  }

  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalRejected = 0;

  console.log(`\n🔄 Migrating ${mdFiles.length} unreachable file(s)...\n`);

  for (const mdFile of mdFiles) {
    const serviceName = basename(mdFile, '.md');
    console.log(`Processing ${serviceName}...`);

    const content = readFileSync(resolve(unreachableDir, mdFile), 'utf8');
    const exemptions = parseUnreachableMarkdown(content);

    console.log(`  Found ${exemptions.length} exemption(s) in ${mdFile}`);

    for (const exemption of exemptions) {
      const newCategory = CATEGORY_MAP[exemption.oldCategory];

      if (newCategory === null) {
        console.log(
          `    ⚠️  REJECTED: "${exemption.oldCategory}" at line ${exemption.line} - should write test instead`
        );
        totalRejected++;
        continue;
      }

      if (newCategory === undefined) {
        console.log(
          `    ⚠️  UNKNOWN category: "${exemption.oldCategory}" at line ${exemption.line} - skipping`
        );
        totalSkipped++;
        continue;
      }

      // Resolve file path relative to service
      let fullPath = exemption.filePath;
      if (
        !fullPath.includes('apps/') &&
        !fullPath.includes('packages/') &&
        !fullPath.includes('workers/')
      ) {
        // Try to guess the correct path
        const possiblePaths = [
          `apps/${serviceName}/${exemption.filePath}`,
          `workers/${serviceName}/${exemption.filePath}`,
          exemption.filePath,
        ];
        for (const p of possiblePaths) {
          if (existsSync(resolve(ROOT_DIR, p))) {
            fullPath = p;
            break;
          }
        }
      }

      const line = findCodeLocation(fullPath, exemption.line);
      if (line === null) {
        console.log(`    ⚠️  SKIPPED: File not found - ${fullPath}`);
        totalSkipped++;
        continue;
      }

      // Extract a short reason from the proof
      // Use first sentence, max 60 chars
      let reason = exemption.proof
        .split('.')[0]
        .toLowerCase()
        .replace(/^(the |this |a |an |it |)/i, '')
        .trim();

      // Truncate if too long
      if (reason.length > 60) {
        reason = reason.substring(0, 57) + '...';
      }

      insertV8IgnoreComment(fullPath, line, newCategory, reason);
      console.log(`    ✓ ${fullPath}:${line} → ${newCategory}`);
      totalMigrated++;
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Migration complete:`);
  console.log(`  ✓ ${totalMigrated} migrated`);
  console.log(`  ⚠️  ${totalSkipped} skipped (file not found or unknown category)`);
  console.log(`  ✗ ${totalRejected} rejected (need tests)`);
  console.log(`\n⚠️  IMPORTANT: Run 'pnpm run verify:v8-ignore' to validate all comments.`);
  console.log(
    `⚠️  If validation passes, run 'pnpm run ci' before deleting unreachable/ directory.`
  );
}

main();
