#!/usr/bin/env npx tsx
/**
 * LLM Architecture Verification Script
 *
 * Verifies the LLM client architecture:
 * 1. Only 4 allowed LLMClient implementations exist (in packages/infra-*)
 * 2. Each implementation calls usageLogger.log() in research() and generate()
 * 3. No hardcoded cost/token values in apps/ (should be calculated in clients)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

const ALLOWED_CLIENT_FILES = [
  'packages/infra-gemini/src/client.ts',
  'packages/infra-gpt/src/client.ts',
  'packages/infra-claude/src/client.ts',
  'packages/infra-perplexity/src/client.ts',
];

interface Violation {
  file: string;
  line: number;
  rule: string;
  message: string;
}

const violations: Violation[] = [];

function walkDir(dir: string, callback: (file: string) => void): void {
  if (!existsSync(dir)) return;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist' && entry !== '__tests__') {
        walkDir(fullPath, callback);
      }
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.spec.ts')
    ) {
      callback(fullPath);
    }
  }
}

function checkRule1_OnlyAllowedClients(): void {
  const implementsLLMClientPattern = /implements\s+LLMClient/;

  walkDir(join(ROOT, 'packages'), (file) => {
    const relPath = relative(ROOT, file);
    if (ALLOWED_CLIENT_FILES.includes(relPath)) return;

    const content = readFileSync(file, 'utf-8');

    if (implementsLLMClientPattern.test(content)) {
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (implementsLLMClientPattern.test(line)) {
          violations.push({
            file: relPath,
            line: idx + 1,
            rule: 'RULE-1',
            message: `Unauthorized LLMClient implementation. Only allowed in: ${ALLOWED_CLIENT_FILES.join(', ')}`,
          });
        }
      });
    }
  });

  walkDir(join(ROOT, 'apps'), (file) => {
    const relPath = relative(ROOT, file);
    const content = readFileSync(file, 'utf-8');

    if (implementsLLMClientPattern.test(content)) {
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (implementsLLMClientPattern.test(line)) {
          violations.push({
            file: relPath,
            line: idx + 1,
            rule: 'RULE-1',
            message: `LLMClient implementations are forbidden in apps/. Use packages/infra-* clients.`,
          });
        }
      });
    }
  });
}

function checkRule2_ClientsLogUsage(): void {
  for (const clientFile of ALLOWED_CLIENT_FILES) {
    const fullPath = join(ROOT, clientFile);
    if (!existsSync(fullPath)) {
      violations.push({
        file: clientFile,
        line: 0,
        rule: 'RULE-2',
        message: `Expected client file does not exist`,
      });
      continue;
    }

    const content = readFileSync(fullPath, 'utf-8');

    const hasUsageLoggerField = /usageLogger[?]?:\s*UsageLogger/.test(content);
    const hasUsageLoggerLog =
      /this\.usageLogger\?\.(log|track)/.test(content) ||
      /usageLogger\?\.(log|track)/.test(content);

    if (!hasUsageLoggerField) {
      violations.push({
        file: clientFile,
        line: 0,
        rule: 'RULE-2',
        message: `Client missing usageLogger field. Each client must accept UsageLogger dependency.`,
      });
    }

    if (!hasUsageLoggerLog) {
      violations.push({
        file: clientFile,
        line: 0,
        rule: 'RULE-2',
        message: `Client does not call usageLogger.log(). Each client must log usage in research()/generate() methods.`,
      });
    }
  }
}

function checkRule3_NoHardcodedCosts(): void {
  const hardcodedPatterns = [
    { pattern: /inputTokens:\s*0[,\s}]/, message: 'Hardcoded inputTokens: 0' },
    { pattern: /outputTokens:\s*0[,\s}]/, message: 'Hardcoded outputTokens: 0' },
    { pattern: /costUsd:\s*0\.0\d+/, message: 'Hardcoded costUsd value' },
    { pattern: /imageCostUsd:\s*0\.0\d+/, message: 'Hardcoded imageCostUsd value' },
  ];

  walkDir(join(ROOT, 'apps'), (file) => {
    const relPath = relative(ROOT, file);

    if (relPath.includes('__tests__')) return;

    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      for (const { pattern, message } of hardcodedPatterns) {
        if (pattern.test(line)) {
          violations.push({
            file: relPath,
            line: idx + 1,
            rule: 'RULE-3',
            message: `${message}. Cost calculation should be in LLMClient implementations only.`,
          });
        }
      }
    });
  });
}

function main(): void {
  console.log('=== LLM Architecture Verification ===\n');

  console.log('Rule 1: Checking for unauthorized LLMClient implementations...');
  checkRule1_OnlyAllowedClients();

  console.log('Rule 2: Checking if clients log usage...');
  checkRule2_ClientsLogUsage();

  console.log('Rule 3: Checking for hardcoded cost values in apps/...');
  checkRule3_NoHardcodedCosts();

  console.log('\n=== Results ===\n');

  if (violations.length === 0) {
    console.log('All checks passed! No violations found.');
    process.exit(0);
  }

  console.log(`Found ${String(violations.length)} violation(s):\n`);

  const byRule = violations.reduce<Record<string, Violation[]>>((acc, v) => {
    acc[v.rule] = acc[v.rule] ?? [];
    acc[v.rule].push(v);
    return acc;
  }, {});

  for (const [rule, ruleViolations] of Object.entries(byRule)) {
    console.log(`\n--- ${rule} ---`);
    for (const v of ruleViolations) {
      console.log(`  ${v.file}:${String(v.line)}`);
      console.log(`    ${v.message}`);
    }
  }

  console.log(`\n Total: ${String(violations.length)} violation(s)`);
  process.exit(1);
}

main();
