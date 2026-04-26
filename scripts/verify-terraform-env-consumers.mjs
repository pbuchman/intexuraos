#!/usr/bin/env node
/**
 * Terraform Env-Var Consumer Verification.
 *
 * Source of truth: every INTEXURAOS_* key declared on the LHS of `=` inside any
 * `env_vars = { ... }` or `env_vars = merge(local.common_service_env_vars, { ... })`
 * block in `terraform/environments/dev/*.tf`. Also includes keys declared in
 * `local.common_service_env_vars = { ... }` AND keys declared in any
 * per-service `env_vars` map nested under `locals { services = { <key> = { ... } } }`.
 *
 * Supported Terraform shapes
 * --------------------------
 *
 * 1) Inline module body:
 *
 *      module "svc" {
 *        source   = "../../modules/cloud-run-service"
 *        env_vars = {
 *          INTEXURAOS_FOO = "bar"
 *        }
 *      }
 *
 * 2) merge() with a common map:
 *
 *      module "svc" {
 *        env_vars = merge(local.common_service_env_vars, {
 *          INTEXURAOS_LOCAL = "x"
 *        })
 *      }
 *
 * 3) Per-service map under locals + for_each:
 *
 *      locals {
 *        services = {
 *          foo = {
 *            name     = "intexuraos-foo"
 *            env_vars = { INTEXURAOS_PER_SVC = "x" }
 *          }
 *        }
 *      }
 *      module "foo" {
 *        for_each = local.services
 *        source   = "../../modules/cloud-run-service"
 *        env_vars = each.value.env_vars
 *      }
 *
 * 4) `locals { common_service_env_vars = { ... } }` keys are ALWAYS harvested.
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
import { groupByName, loadKnownDrift } from './lib/known-drift.mjs';

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
 * Mask out the *interiors* of double-quoted strings on a single line by
 * replacing each interior character with a space, leaving the quotes intact.
 * Length and column offsets are preserved, which keeps brace tracking and
 * line/column reporting consistent with the original file.
 */
function maskStrings(line) {
  return line.replace(/"((?:[^"\\]|\\.)*)"/g, (_, inner) => `"${' '.repeat(inner.length)}"`);
}

/**
 * Mask HCL line comments (`#...$`, `//...$`) on a line that has ALREADY had
 * string interiors masked. This avoids treating a `//` inside a string value
 * as a comment. Replaces every comment character with a space so column
 * offsets stay aligned.
 */
function maskLineComments(strMasked) {
  return strMasked.replace(/(#|\/\/).*$/, (m) => ' '.repeat(m.length));
}

/**
 * Walk the file line-by-line and yield env-var declarations from any block we
 * care about. We track whether we're inside an `env_vars = { ... }` block
 * (which can also be the body of a `merge(...)` second-arg map) OR inside a
 * `local.common_service_env_vars = { ... }` declaration OR inside a
 * per-service `env_vars = { ... }` map nested under
 * `locals { services = { <key> = { ... } } }`.
 *
 * Brace tracking:
 *   - String literals are stripped FIRST so `"{"` inside a value is ignored.
 *   - HCL line comments are stripped next so a commented-out `}` doesn't pop.
 *   - Heredoc bodies (`<<EOT ... EOT`, `<<-EOT ... EOT`) are skipped entirely
 *     because their content is opaque text, not HCL.
 */
function extractTerraformEnvVars(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const declarations = []; // {name, file, line, ignoreReason|null}

  let depth = 0;
  let stack = []; // stack of context tags as we descend braces
  let heredocLabel = null; // when set, we're inside a heredoc body

  // Per-frame "shape" hints:
  //   'env'           — env_vars / common_service_env_vars / per-service env_vars body
  //   'services'      — locals.services map body
  //   'service-entry' — single entry inside locals.services (e.g. `foo = { ... }`)
  //   'other'         — generic frame
  //
  // When we open a `{` directly after `env_vars =` we push 'env'. When we open
  // a `{` directly after `services =` (inside a `locals` frame) we push
  // 'services'. When the parent frame is 'services', the next `{` we see is
  // the body of an entry, so we push 'service-entry'. From there, an
  // `env_vars = {` triggers 'env'.

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNo = i + 1;

    // ── Heredoc handling ───────────────────────────────────────────────
    if (heredocLabel !== null) {
      // Look for the closing label on its own line (optionally indented).
      if (new RegExp(`^\\s*${heredocLabel}\\s*$`).test(rawLine)) {
        heredocLabel = null;
      }
      continue;
    }

    // ── String + comment masking (B1, I2) ──────────────────────────────
    // Mask string interiors first so `//` inside a quoted value isn't seen
    // as a comment, AND so the inline-ignore regex can't match a `//` inside
    // a string. Then mask line comments so a commented-out `}` doesn't pop.
    // Both passes preserve column offsets (replace with spaces).
    const stringMasked = maskStrings(rawLine);
    const stripped = maskLineComments(stringMasked);

    // ── Heredoc opener detection ───────────────────────────────────────
    // Detect heredoc openers on the STRING-MASKED line so a `<<EOT` literal
    // sitting inside a quoted string value cannot falsely enter heredoc mode.
    const heredocOpen = /<<-?([A-Z_][A-Z0-9_]*)\b/.exec(stringMasked);
    if (heredocOpen) {
      // The opener line itself is real HCL (assignments etc.) — but since the
      // body that follows is opaque, we still need to scan the opener for any
      // env-var declarations (none usually) and process its braces. The
      // simpler choice: process opener normally, then enter heredoc state for
      // subsequent lines.
      heredocLabel = heredocOpen[1];
    }

    // ── Inline ignore detection ────────────────────────────────────────
    // Inline-ignore comments are themselves `//` comments — they live on the
    // string-masked line BEFORE comment masking. A `//` that survives
    // maskStrings was a real comment, not a string-embedded one.
    const ignoreMatch = INLINE_IGNORE_PATTERN.exec(stringMasked);

    // ── Detect env-var declarations on this line ───────────────────────
    const insideEnvBlock = stack.includes('env');
    if (insideEnvBlock) {
      const decl = ENV_VAR_LINE_PATTERN.exec(stripped);
      if (decl) {
        declarations.push({
          name: decl[1],
          file: filePath,
          line: lineNo,
          ignoreReason: ignoreMatch ? ignoreMatch[1].trim() : null,
        });
      }
    }

    // ── Frame detection on this line ───────────────────────────────────
    // Detect entering an env_vars block on this line.
    // env_vars = { ...   OR   env_vars = merge(local.common_service_env_vars, {
    // Also recognize `extra_env_vars = { ... }` (Subtask E Contract 2 forward-compat).
    // The optional `extra_` prefix needs explicit alternation because `_` is a
    // word char, so `\b` does NOT fire between `extra` and `env_vars`.
    const envVarsAssign = /\b(?:extra_)?env_vars\s*=\s*(\{|merge\s*\()/.test(stripped);
    // Detect entering common_service_env_vars block.
    const commonAssign = /\bcommon_service_env_vars\s*=\s*\{/.test(stripped);
    // Detect entering services-locals map: `services = {`.
    const servicesAssign = /\bservices\s*=\s*\{/.test(stripped);
    // Detect entering locals { ... } block (so we know our parent context).
    const localsOpen = /^\s*locals\s*\{/.test(stripped);

    // Pending push hints for the next opening `{` on this line.
    let pushEnv = envVarsAssign || commonAssign ? 1 : 0;
    let pushServices = servicesAssign ? 1 : 0;
    let pushLocals = localsOpen ? 1 : 0;

    for (const ch of stripped) {
      if (ch === '{') {
        let frame;
        if (pushLocals > 0) {
          frame = 'locals';
          pushLocals -= 1;
        } else if (pushEnv > 0) {
          frame = 'env';
          pushEnv -= 1;
        } else if (pushServices > 0) {
          frame = 'services';
          pushServices -= 1;
        } else if (stack.length > 0 && stack[stack.length - 1] === 'services') {
          // Direct child of services map → an entry like `foo = { ... }`.
          frame = 'service-entry';
        } else {
          frame = 'other';
        }
        stack.push(frame);
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
  const byName = groupByName(allDeclarations, 'name');

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
    console.log(`✓ checked ${String(byName.size)} Terraform env vars`);
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
