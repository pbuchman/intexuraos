#!/usr/bin/env node
/**
 * Terraform Env-Var Consumer Verification.
 *
 * Source of truth: every INTEXURAOS_* key declared on the LHS of `=` inside any
 * `env_vars = { ... }` or `env_vars = merge(local.common_service_env_vars, { ... })`
 * block in `terraform/environments/dev/*.tf`. Also includes keys declared in
 * `local.common_service_env_vars = { ... }`.
 *
 * Consumer rule: each unique INTEXURAOS_* name MUST appear as a literal string
 * somewhere under `apps/<svc>/src/` or `workers/<svc>/src/`. Zero matches → drift.
 *
 * Drift entries not listed in `scripts/__fixtures__/known-drift.json#terraformEnvConsumers`
 * (or marked with an inline `// verify-terraform-env-consumers:ignore = reason`
 * comment on the same line) cause a non-zero exit.
 *
 * Stale allowlist entries (allowlisted name now consumed OR no longer in Terraform)
 * also fail to prevent allowlist rot.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadKnownDrift } from './lib/known-drift.mjs';

const repoRoot = process.env.INTEXURAOS_VERIFY_REPO_ROOT
  ? resolve(process.env.INTEXURAOS_VERIFY_REPO_ROOT)
  : resolve(import.meta.dirname, '..');

const tfDir = join(repoRoot, 'terraform', 'environments', 'dev');
const appsDir = join(repoRoot, 'apps');
const workersDir = join(repoRoot, 'workers');

const INLINE_IGNORE_PATTERN = /\/\/\s*verify-terraform-env-consumers:ignore\s*=\s*(.+)$/;
const ENV_VAR_LINE_PATTERN = /^\s*(INTEXURAOS_[A-Z0-9_]+)\s*=/;

function listTfFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.tf'))
    .map((name) => join(dir, name));
}

/**
 * Walk the file line-by-line and yield env-var declarations from any block we
 * care about. We track whether we're inside an `env_vars = { ... }` block
 * (which can also be the body of a `merge(...)` second-arg map) OR inside a
 * `local.common_service_env_vars = { ... }` declaration.
 *
 * Brace tracking is approximate but sufficient: HCL is regular enough that
 * counting `{`/`}` on each non-string line gives correct nesting depth.
 */
function extractTerraformEnvVars(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const declarations = []; // {name, file, line, ignoreReason|null}

  // State machine over the entire file.
  let depth = 0;
  let stack = []; // stack of context tags as we descend braces

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // Detect entering an env_vars block on this line.
    // env_vars = { ...   OR   env_vars = merge(local.common_service_env_vars, {
    const envVarsAssign = /\benv_vars\s*=\s*(\{|merge\s*\()/.exec(line);

    // Detect entering common_service_env_vars block.
    const commonAssign = /common_service_env_vars\s*=\s*\{/.exec(line);

    // First, if we're inside an env-var bearing block, scan this line for a
    // declaration BEFORE we update depth tracking (line could close the block).
    const insideEnvBlock = stack.some((s) => s === 'env');
    if (insideEnvBlock) {
      const decl = ENV_VAR_LINE_PATTERN.exec(line);
      if (decl) {
        const ignoreMatch = INLINE_IGNORE_PATTERN.exec(line);
        declarations.push({
          name: decl[1],
          file: filePath,
          line: lineNo,
          ignoreReason: ignoreMatch ? ignoreMatch[1].trim() : null,
        });
      }
    }

    // Process braces on the line, tracking stack pushes/pops.
    // Strip strings to avoid counting `{` inside string literals.
    const stripped = line.replace(/"(?:[^"\\]|\\.)*"/g, '""');

    let pushedThisLine = 0;
    if (envVarsAssign || commonAssign) {
      // Push 'env' frame for each `{` opening contributed by the assign expression.
      // For `env_vars = { ... }` the brace is counted in the general open count below.
      // We mark the NEXT open brace as belonging to env context.
      pushedThisLine += 1;
    }

    for (const ch of stripped) {
      if (ch === '{') {
        if (pushedThisLine > 0) {
          stack.push('env');
          pushedThisLine -= 1;
        } else {
          stack.push('other');
        }
        depth += 1;
      } else if (ch === '}') {
        if (depth > 0) {
          stack.pop();
          depth -= 1;
        }
      }
    }
  }

  return declarations;
}

function findTsFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
      findTsFiles(fullPath, files);
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.mjs') || entry.endsWith('.js')) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.d.ts')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function buildConsumerCorpus() {
  const files = [];
  for (const root of [appsDir, workersDir]) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const srcDir = join(root, entry, 'src');
      if (existsSync(srcDir)) findTsFiles(srcDir, files);
    }
  }
  // Concatenate all sources into a single haystack for fast literal search.
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

function main() {
  const tfFiles = listTfFiles(tfDir);
  const allDeclarations = tfFiles.flatMap(extractTerraformEnvVars);

  if (allDeclarations.length === 0) {
    console.log('✓ No INTEXURAOS_* env vars declared in Terraform');
    process.exit(0);
  }

  const corpus = buildConsumerCorpus();

  // Group declarations by name (a name may appear in multiple files/lines).
  const byName = new Map();
  for (const d of allDeclarations) {
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d);
  }

  const drift = loadKnownDrift(repoRoot);
  const allowlist = drift.terraformEnvConsumers ?? {};
  const allowlistedNames = new Set(Object.keys(allowlist));

  const newDrift = []; // {name, file, line}
  const inlineIgnoredNames = new Set();
  const stillDrifting = new Set();

  for (const [name, decls] of byName) {
    const consumed = corpus.includes(name);
    const inlineIgnored = decls.some((d) => d.ignoreReason !== null);
    if (inlineIgnored) inlineIgnoredNames.add(name);

    if (consumed) continue;
    if (inlineIgnored) continue;
    if (allowlistedNames.has(name)) {
      stillDrifting.add(name);
      continue;
    }
    for (const d of decls) {
      newDrift.push({ name, file: d.file, line: d.line });
    }
  }

  // Stale allowlist: any allowlisted name that does NOT show up in stillDrifting
  // (either no longer declared in Terraform OR now consumed) is stale.
  const staleAllowlist = [];
  for (const name of allowlistedNames) {
    if (!stillDrifting.has(name)) staleAllowlist.push(name);
  }

  if (newDrift.length === 0 && staleAllowlist.length === 0) {
    console.log(`✓ All ${String(byName.size)} Terraform env vars have a code consumer`);
    process.exit(0);
  }

  if (newDrift.length > 0) {
    console.error('❌ Terraform env vars without a code consumer:');
    for (const d of newDrift) {
      const rel = d.file.replace(repoRoot + '/', '');
      console.error(`  - ${d.name} (declared at ${rel}:${String(d.line)})`);
    }
    console.error('');
    console.error('FIX: either consume the variable in apps/*/src or workers/*/src, OR add it to');
    console.error(
      'scripts/__fixtures__/known-drift.json#terraformEnvConsumers with an issue reference.'
    );
  }

  if (staleAllowlist.length > 0) {
    console.error('❌ stale allowlist entries in known-drift.json#terraformEnvConsumers:');
    for (const n of staleAllowlist) {
      console.error(`  - ${n} (no longer drifting — remove from allowlist)`);
    }
  }

  process.exit(1);
}

main();
