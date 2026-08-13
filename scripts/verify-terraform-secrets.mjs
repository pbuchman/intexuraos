#!/usr/bin/env node
/**
 * Terraform Secrets Verification
 *
 * Detects hardcoded secrets in Terraform files.
 *
 * Algorithm:
 * 1. Scan all .tf and .tfvars files in terraform/
 * 2. Check for secret patterns (API keys, tokens, private keys)
 * 3. Allow patterns: var., data., module., google_secret_manager_secret
 * 4. Report violations with matched content and remediation
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const terraformDir = join(repoRoot, 'terraform');

const SECRET_PATTERNS = [
  { regex: /["']AIza[A-Za-z0-9_-]{35,}["']/g, name: 'Google API Key' },
  { regex: /["']sk-[A-Za-z0-9]{20,}["']/g, name: 'OpenAI API Key' },
  { regex: /["']xoxb-[A-Za-z0-9-]{10,}["']/g, name: 'Slack Token' },
  { regex: /["']AKIA[A-Z0-9]{16}["']/g, name: 'AWS Access Key' },
  {
    regex: /(password|secret|token|key)\s*=\s*["'][A-Za-z0-9+/=]{32,}["']/gi,
    name: 'Potential Secret',
  },
  { regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g, name: 'Private Key' },
];

const FORBIDDEN_STATE_PATTERNS = [
  {
    regex: /\bsecret_data\b/u,
    name: 'Secret payload written to Terraform state',
  },
  {
    regex: /^\s*data\s+"google_secret_manager_secret_version"\s+/u,
    name: 'Secret Manager version data source writes payload to Terraform state',
  },
];

const ALLOWED_PATTERNS = [
  /var\./,
  /data\./,
  /module\./,
  /local\./,
  /google_secret_manager_secret/,
  /google_service_account/,
  /<PROJECT_ID>/,
  /<YOUR_/,
  /example\.com/,
  /REPLACE_ME/,
  /TODO/,
];

function getTerraformFiles(dir) {
  const files = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === '.terraform' || entry === 'node_modules') continue;
        files.push(...getTerraformFiles(fullPath));
      } else if (entry.endsWith('.tf') || entry.endsWith('.tfvars')) {
        files.push(fullPath);
      }
    }
  } catch {
    /* Directory doesn't exist */
  }
  return files;
}

function isAllowedContext(line) {
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(line));
}

function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('#') || line.trim().startsWith('//')) continue;

    for (const { regex, name } of FORBIDDEN_STATE_PATTERNS) {
      if (regex.test(line)) {
        violations.push({
          line: i + 1,
          type: name,
          content: '[redacted Terraform secret-state expression]',
          matched: '[redacted]',
        });
      }
    }
    if (isAllowedContext(line)) continue;

    for (const { regex, name } of SECRET_PATTERNS) {
      const matches = line.matchAll(new RegExp(regex));
      for (const _match of matches) {
        violations.push({
          line: i + 1,
          type: name,
          content: '[redacted Terraform source line]',
          matched: '[redacted]',
        });
      }
    }
  }
  return violations;
}

// Main execution
console.log('Scanning Terraform files for hardcoded secrets...\n');

const files = getTerraformFiles(terraformDir);
console.log(`✓ Found ${String(files.length)} Terraform file(s)`);

const allViolations = [];
for (const file of files) {
  const violations = checkFile(file);
  if (violations.length > 0) {
    allViolations.push({ file: file.replace(repoRoot + '/', ''), violations });
  }
}

if (allViolations.length === 0) {
  console.log('✓ No hardcoded secrets detected\n');
  process.exit(0);
}

console.error('❌ POTENTIAL SECRETS DETECTED\n');
for (const { file, violations } of allViolations) {
  console.error(`  ${file}:`);
  for (const v of violations) {
    console.error(`    Line ${String(v.line)}: ${v.type}`);
    console.error(`      Matched: ${v.matched}`);
  }
  console.error('');
}

console.error('RULE: Never hardcode secrets in Terraform files.');
console.error('Use var.<variable_name> or google_secret_manager_secret\n');
process.exit(1);
