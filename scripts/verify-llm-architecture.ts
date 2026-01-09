#!/usr/bin/env npx tsx
/**
 * LLM Architecture Verification Script
 *
 * Verifies the LLM client architecture:
 * 1. Only allowed LLMClient implementations exist (in packages/infra-*)
 * 2. Each implementation accepts usageLogger and calls it for logging
 * 3. No hardcoded cost values in apps/ (should be calculated in clients)
 * 4. No hardcoded model strings outside llm-contract (except migrations)
 * 5. No hardcoded provider strings outside llm-contract (except migrations)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

const ALLOWED_CLIENT_FILES = [
  // Legacy clients (v1)
  'packages/infra-gemini/src/client.ts',
  'packages/infra-gpt/src/client.ts',
  'packages/infra-claude/src/client.ts',
  'packages/infra-perplexity/src/client.ts',
];

// All LLM model string literals that should not appear outside llm-contract
const MODEL_STRINGS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-flash-image',
  'o4-mini-deep-research',
  'gpt-5.2',
  'gpt-4o-mini',
  'gpt-image-1',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4-5-20250929',
  'claude-3-5-haiku-20241022',
  'sonar-deep-research',
  'sonar-pro',
  // 'sonar' is checked separately due to substring issues
];

// Provider string literals that should not appear outside llm-contract
const PROVIDER_STRINGS = ['google', 'openai', 'anthropic', 'perplexity'];

// Directories/files excluded from hardcoded string checks
const EXCLUDED_PATHS = ['packages/llm-contract/', 'migrations/', 'node_modules/', 'dist/', '.git/'];

interface Violation {
  file: string;
  line: number;
  rule: string;
  message: string;
  content?: string;
}

const violations: Violation[] = [];

interface WalkOptions {
  includeTests?: boolean;
  includeTsx?: boolean;
}

function walkDir(dir: string, callback: (file: string) => void, options: WalkOptions = {}): void {
  if (!existsSync(dir)) return;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist') {
        if (entry === '__tests__' && !options.includeTests) {
          continue;
        }
        walkDir(fullPath, callback, options);
      }
    } else {
      const isTsFile = entry.endsWith('.ts') && !entry.endsWith('.d.ts');
      const isTsxFile = entry.endsWith('.tsx');
      const isTestFile =
        entry.endsWith('.test.ts') ||
        entry.endsWith('.spec.ts') ||
        entry.endsWith('.test.tsx') ||
        entry.endsWith('.spec.tsx');

      if (isTsFile && !isTestFile) {
        callback(fullPath);
      } else if (isTsxFile && options.includeTsx && !isTestFile) {
        callback(fullPath);
      } else if (isTestFile && options.includeTests) {
        callback(fullPath);
      }
    }
  }
}

function walkAllSourceFiles(dir: string, callback: (file: string) => void): void {
  walkDir(dir, callback, { includeTests: true, includeTsx: true });
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

    // Check that client imports logUsage from @intexuraos/llm-pricing
    const hasLogUsageImport =
      /import\s*\{[^}]*logUsage[^}]*\}\s*from\s*['"]@intexuraos\/llm-pricing['"]/.test(content);

    // Check that logUsage is called (directly or via a trackUsage helper)
    const hasLogUsageCall = /\blogUsage\s*\(/.test(content) || /\btrackUsage\s*\(/.test(content);

    if (!hasLogUsageImport) {
      violations.push({
        file: clientFile,
        line: 0,
        rule: 'RULE-2',
        message: `Client missing logUsage import. Must import { logUsage } from '@intexuraos/llm-pricing'.`,
      });
    }

    if (!hasLogUsageCall) {
      violations.push({
        file: clientFile,
        line: 0,
        rule: 'RULE-2',
        message: `Client does not call logUsage(). Each client must log usage via llm-pricing.`,
      });
    }
  }
}

function checkRule3_NoHardcodedCosts(): void {
  // Only check for hardcoded COST values, not zero tokens (which are valid in error paths)
  const hardcodedPatterns = [
    { pattern: /costUsd:\s*0\.\d+/, message: 'Hardcoded costUsd value' },
    { pattern: /imageCostUsd:\s*0\.\d+/, message: 'Hardcoded imageCostUsd value' },
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

function isExcludedPath(relPath: string): boolean {
  return EXCLUDED_PATHS.some((excluded) => relPath.includes(excluded));
}

function isInComment(line: string, matchIndex: number): boolean {
  // Check if match is inside a single-line comment
  const beforeMatch = line.substring(0, matchIndex);
  return beforeMatch.includes('//') || beforeMatch.includes('*');
}

function isQuotedString(line: string, modelString: string): boolean {
  // Check if the model string appears as a quoted string literal
  const singleQuoted = `'${modelString}'`;
  const doubleQuoted = `"${modelString}"`;
  const backtickQuoted = `\`${modelString}\``;

  return (
    line.includes(singleQuoted) || line.includes(doubleQuoted) || line.includes(backtickQuoted)
  );
}

function checkRule4_NoHardcodedModelStrings(): void {
  const dirsToScan = [join(ROOT, 'apps'), join(ROOT, 'packages')];

  for (const dir of dirsToScan) {
    walkAllSourceFiles(dir, (file) => {
      const relPath = relative(ROOT, file);

      // Skip excluded paths
      if (isExcludedPath(relPath)) return;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, idx) => {
        // Skip if this appears to be a keyword array (natural language matching)
        // e.g., ['gemini flash', 'google'] for user input parsing
        if (
          line.includes('[') &&
          line.includes(']') &&
          (line.includes("'") || line.includes('"')) &&
          line.includes(',')
        ) {
          // Check if it's inside a string array (keyword list)
          const arrayPattern = /\[[\s'",\w-]+\]/;
          if (arrayPattern.test(line)) {
            return;
          }
        }

        // Check each model string
        for (const modelString of MODEL_STRINGS) {
          if (isQuotedString(line, modelString)) {
            const matchIndex = line.indexOf(modelString);
            if (!isInComment(line, matchIndex)) {
              violations.push({
                file: relPath,
                line: idx + 1,
                rule: 'RULE-4',
                message: `Hardcoded model string '${modelString}'. Use LlmModels constant instead.`,
                content: line.trim(),
              });
            }
          }
        }

        // Special handling for 'sonar' - must be exact match, not substring
        const sonarPatterns = [/'sonar'/, /"sonar"/, /`sonar`/];
        for (const pattern of sonarPatterns) {
          if (pattern.test(line)) {
            const matchIndex = line.search(pattern);
            if (!isInComment(line, matchIndex)) {
              violations.push({
                file: relPath,
                line: idx + 1,
                rule: 'RULE-4',
                message: `Hardcoded model string 'sonar'. Use LlmModels constant instead.`,
                content: line.trim(),
              });
            }
          }
        }
      });
    });
  }
}

function checkRule5_NoHardcodedProviderStrings(): void {
  const dirsToScan = [join(ROOT, 'apps'), join(ROOT, 'packages')];

  for (const dir of dirsToScan) {
    walkAllSourceFiles(dir, (file) => {
      const relPath = relative(ROOT, file);

      // Skip excluded paths
      if (isExcludedPath(relPath)) return;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, idx) => {
        for (const providerString of PROVIDER_STRINGS) {
          // Check for quoted provider strings in specific contexts
          const patterns = [
            // Direct string usage: 'google', "openai"
            new RegExp(`['"\`]${providerString}['"\`]`),
          ];

          for (const pattern of patterns) {
            if (pattern.test(line)) {
              const matchIndex = line.search(pattern);
              if (!isInComment(line, matchIndex)) {
                // Additional context checks to reduce false positives
                // Skip if it's clearly not an LLM provider context
                const lowerLine = line.toLowerCase();

                // Skip OAuth/auth contexts for 'google'
                if (
                  providerString === 'google' &&
                  (lowerLine.includes('oauth') ||
                    lowerLine.includes('auth0') ||
                    lowerLine.includes('firebase') ||
                    lowerLine.includes('gcloud') ||
                    lowerLine.includes('storage'))
                ) {
                  continue;
                }

                // Skip if this appears to be a keyword array (natural language matching)
                // e.g., ['gemini flash', 'google'] for user input parsing
                if (
                  line.includes('[') &&
                  line.includes(']') &&
                  (line.includes("'") || line.includes('"')) &&
                  line.includes(',')
                ) {
                  // Check if it's inside a string array (keyword list)
                  const arrayPattern = /\[[\s'",\w-]+\]/;
                  if (arrayPattern.test(line)) {
                    continue;
                  }
                }

                // Flag if it looks like LLM provider usage
                const llmContextPatterns = [
                  /provider/i,
                  /llm/i,
                  /model/i,
                  /pricing/i,
                  /getby/i,
                  /adapter/i,
                  /client/i,
                  /research/i,
                  /synthesis/i,
                ];

                const hasLlmContext = llmContextPatterns.some((p) => p.test(line));

                // Also flag type assertions and comparisons
                const isTypeAssertion =
                  line.includes(` as Llm`) || line.includes(` as '${providerString}'`);
                const isComparison =
                  line.includes(`=== '${providerString}'`) ||
                  line.includes(`!== '${providerString}'`) ||
                  line.includes(`== '${providerString}'`);

                if (hasLlmContext || isTypeAssertion || isComparison) {
                  violations.push({
                    file: relPath,
                    line: idx + 1,
                    rule: 'RULE-5',
                    message: `Hardcoded provider string '${providerString}'. Use LlmProviders constant instead.`,
                    content: line.trim(),
                  });
                }
              }
            }
          }
        }
      });
    });
  }
}

function main(): void {
  console.log('=== LLM Architecture Verification ===\n');

  console.log('Rule 1: Checking for unauthorized LLMClient implementations...');
  checkRule1_OnlyAllowedClients();

  console.log('Rule 2: Checking if clients log usage...');
  checkRule2_ClientsLogUsage();

  console.log('Rule 3: Checking for hardcoded cost values in apps/...');
  checkRule3_NoHardcodedCosts();

  console.log('Rule 4: Checking for hardcoded model strings...');
  checkRule4_NoHardcodedModelStrings();

  console.log('Rule 5: Checking for hardcoded provider strings...');
  checkRule5_NoHardcodedProviderStrings();

  // Separate blocking violations (RULE-1, RULE-2, RULE-3) from warnings (RULE-4, RULE-5)
  // All rules are now blocking after task 029-type-safe-llm-constants completion
  const blockingRules = ['RULE-1', 'RULE-2', 'RULE-3', 'RULE-4', 'RULE-5'];
  const warningRules: string[] = [];

  const blockingViolations = violations.filter((v) => blockingRules.includes(v.rule));
  const warningViolations = violations.filter((v) => warningRules.includes(v.rule));

  if (blockingViolations.length === 0 && warningViolations.length === 0) {
    console.log('All checks passed! No violations found.');
    process.exit(0);
  }

  const byRule = violations.reduce<Record<string, Violation[]>>((acc, v) => {
    acc[v.rule] = acc[v.rule] ?? [];
    acc[v.rule].push(v);
    return acc;
  }, {});

  // Print blocking violations
  if (blockingViolations.length > 0) {
    console.log(`\n❌ Found ${String(blockingViolations.length)} BLOCKING violation(s):\n`);
    for (const rule of blockingRules) {
      const ruleViolations = byRule[rule];
      if (ruleViolations !== undefined && ruleViolations.length > 0) {
        console.log(`\n--- ${rule} (${String(ruleViolations.length)} violations) ---`);
        for (const v of ruleViolations) {
          console.log(`  ${v.file}:${String(v.line)}`);
          console.log(`    ${v.message}`);
        }
      }
    }
  }

  // Print warnings (non-blocking) - currently none
  if (warningViolations.length > 0) {
    console.log(`\n⚠️  Found ${String(warningViolations.length)} WARNING violation(s):\n`);
    for (const rule of warningRules) {
      const ruleViolations = byRule[rule];
      if (ruleViolations !== undefined && ruleViolations.length > 0) {
        console.log(`   ${rule}: ${String(ruleViolations.length)} violation(s)`);
      }
    }
  }

  console.log(`\n=== Summary ===`);
  for (const [rule, ruleViolations] of Object.entries(byRule)) {
    const isBlocking = blockingRules.includes(rule);
    console.log(
      `  ${rule}: ${String(ruleViolations.length)} violation(s) ${isBlocking ? '(BLOCKING)' : '(warning)'}`
    );
  }
  console.log(`  Total: ${String(violations.length)} violation(s)`);

  // Only fail on blocking violations
  if (blockingViolations.length > 0) {
    process.exit(1);
  }

  console.log('\n✅ All blocking checks passed. Warnings remain to be fixed.');
  process.exit(0);
}

main();
