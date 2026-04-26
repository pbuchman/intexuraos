#!/usr/bin/env node
/**
 * Terraform Secret-Mount Verification.
 *
 * Source of truth: every key in the `secrets = { "<NAME>" = "..." }` map of
 * the secret-manager module (matched by `source = "../../modules/secret-manager"`,
 * NOT by module name) in `terraform/environments/dev/*.tf`. Each key spawns a
 * `google_secret_manager_secret` via `for_each` in the secret-manager module.
 *
 * Consumer rule: each secret name MUST appear in at least one `secrets = { ... }`
 * block (including `secrets = merge(local.common_service_secrets, { ... })`)
 * attached to a `module "..."` block in the same terraform/environments/dev/*.tf
 * tree, OR in `local.common_service_secrets`. Any cloud-run-service or
 * cloud-function module counts. Modules whose source is the secret-manager
 * module itself are skipped (matched by source path, not name).
 *
 * Orphans not in `known-drift.json#terraformSecretMounts` (or marked with an
 * inline `// verify-terraform-secret-mounts:ignore = reason` comment on the
 * declaration line) cause non-zero exit.
 *
 * Stale allowlist entries (allowlisted name now mounted OR no longer declared)
 * also fail.
 *
 * Brace tracking strips string literals first, then HCL line comments
 * (`#...$`, `//...$`), and skips heredoc bodies entirely so opaque text in
 * those constructs cannot corrupt depth counters.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { groupByName, loadKnownDrift } from './lib/known-drift.mjs';

const repoRoot = process.env.INTEXURAOS_VERIFY_REPO_ROOT
  ? resolve(process.env.INTEXURAOS_VERIFY_REPO_ROOT)
  : resolve(import.meta.dirname, '..');

const tfDir = join(repoRoot, 'terraform', 'environments', 'dev');

const INLINE_IGNORE_PATTERN = /\/\/\s*verify-terraform-secret-mounts:ignore\s*=\s*(.+)$/;
const SECRET_MANAGER_SOURCE = '../../modules/secret-manager';

function listTfFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.tf'))
    .map((n) => join(dir, n));
}

/**
 * Mask out the *interiors* of double-quoted strings on a single line by
 * replacing each interior character with a space, leaving the surrounding
 * quotes intact. This preserves the line length and column offsets, which
 * matters when callers need to map a regex match back to an absolute index.
 */
function maskStrings(line) {
  return line.replace(/"((?:[^"\\]|\\.)*)"/g, (_, inner) => `"${' '.repeat(inner.length)}"`);
}

/**
 * Mask HCL line comments (`#...$`, `//...$`) on a line that has ALREADY had
 * string interiors masked out. Replaces every comment character with a space
 * so column offsets stay aligned with the original line.
 */
function maskLineComments(strMasked) {
  return strMasked.replace(/(#|\/\/).*$/, (m) => ' '.repeat(m.length));
}

/**
 * Walk `src` from index `openIdx` (a `{`) and return the index of the matching
 * `}`. Honors string literals, HCL line comments, and heredoc bodies so
 * embedded braces don't throw off the depth counter. Returns -1 if no match.
 */
function matchBraceSafe(src, openIdx) {
  // We process line-by-line starting from the line containing openIdx, but
  // we need to stop at the exact matching brace. Convert to lines + map back.
  let depth = 0;
  let heredocLabel = null;

  // Walk each line; the opener line may contain content before openIdx.
  let cursor = 0;
  const lines = src.split('\n');
  // Build a lookup of the absolute index of the START of each line.
  const lineStarts = [0];
  for (let i = 0; i < lines.length - 1; i++) {
    lineStarts.push(lineStarts[i] + lines[i].length + 1);
  }

  // Find which line openIdx lives on.
  let startLine = 0;
  for (let i = 0; i < lineStarts.length; i++) {
    if (lineStarts[i] > openIdx) {
      startLine = i - 1;
      break;
    }
    startLine = i;
  }

  for (let li = startLine; li < lines.length; li++) {
    const rawLine = lines[li];
    const lineAbsStart = lineStarts[li];

    if (heredocLabel !== null) {
      if (new RegExp(`^\\s*${heredocLabel}\\s*$`).test(rawLine)) {
        heredocLabel = null;
      }
      continue;
    }
    const heredocOpen = /<<-?([A-Z_][A-Z0-9_]*)\b/.exec(rawLine);
    if (heredocOpen) heredocLabel = heredocOpen[1];

    const stripped = maskLineComments(maskStrings(rawLine));
    // For the opener line, only count braces from openIdx onward.
    const lineOffset = li === startLine ? openIdx - lineAbsStart : 0;
    for (let i = lineOffset; i < stripped.length; i++) {
      const ch = stripped[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return lineAbsStart + i;
        }
      }
    }
    cursor = lineAbsStart + rawLine.length;
  }
  return -1;
}

/**
 * Walk `body` and find the matching `}` for the `{` at index `openIdx` within
 * `body`. Same safety as matchBraceSafe but local to the substring (no need
 * to map line numbers).
 */
function matchBraceLocal(body, openIdx) {
  return matchBraceSafe(body, openIdx);
}

/**
 * Find the secret-manager module block (matched by `source` path, not name)
 * and return declared secret names with line numbers and inline-ignore reasons.
 *
 * Returns: Array<{ name, file, line, ignoreReason|null }>
 */
function extractDeclaredSecrets(files) {
  const decls = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');

    // Walk every `module "X" { ... }` and pick the one whose source matches.
    const modulePattern = /module\s+"([a-z_][a-z0-9_]*)"\s*\{/g;
    let mm;
    while ((mm = modulePattern.exec(content)) !== null) {
      const startIdx = mm.index;
      const openBraceIdx = content.indexOf('{', startIdx);
      const endIdx = matchBraceSafe(content, openBraceIdx);
      if (endIdx === -1) continue;
      modulePattern.lastIndex = endIdx;
      const moduleBody = content.slice(openBraceIdx + 1, endIdx);

      if (!sourceMatches(moduleBody, SECRET_MANAGER_SOURCE)) continue;

      // Inside, find `secrets = {` and harvest "INTEXURAOS_*" keys.
      const secretsMatch = /\bsecrets\s*=\s*\{/.exec(moduleBody);
      if (!secretsMatch) continue;
      const secretsOpenIdx = moduleBody.indexOf('{', secretsMatch.index);
      const secretsEnd = matchBraceLocal(moduleBody, secretsOpenIdx);
      if (secretsEnd === -1) continue;
      const secretsBody = moduleBody.slice(secretsOpenIdx + 1, secretsEnd);

      // Compute the absolute line number for the `secrets = {` line directly
      // from the original `content`. This avoids fiddly arithmetic.
      const absSecretsOpenIdx = openBraceIdx + 1 + secretsOpenIdx;
      const secretsBodyStartLine = content.slice(0, absSecretsOpenIdx).split('\n').length;

      const lines = secretsBody.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        // Extract the secret name from the RAW line — the name lives inside
        // a string literal so we must NOT strip strings before this match.
        const m = /^\s*"(INTEXURAOS_[A-Z0-9_]+)"\s*=/.exec(rawLine);
        if (!m) continue;
        // For the inline-ignore comment, mask string interiors first so a
        // `// verify-…:ignore = bogus` payload baked inside another string
        // value cannot suppress the drift (B1).
        const masked = maskStrings(rawLine);
        const ignoreMatch = INLINE_IGNORE_PATTERN.exec(masked);
        decls.push({
          name: m[1],
          file,
          line: secretsBodyStartLine + i,
          ignoreReason: ignoreMatch ? ignoreMatch[1].trim() : null,
        });
      }
    }
  }
  return decls;
}

function sourceMatches(moduleBody, expected) {
  const m = /\bsource\s*=\s*"([^"]+)"/.exec(moduleBody);
  return m !== null && m[1] === expected;
}

/**
 * Collect every secret name *referenced* in any `secrets = { ... }` block
 * inside any `module "..."` block (other than the secret-manager module
 * itself, matched by source path), AND every key inside
 * `local.common_service_secrets = { ... }`.
 *
 * Returns: Set<string>
 */
function extractMountedSecrets(files) {
  const mounted = new Set();

  for (const file of files) {
    const content = readFileSync(file, 'utf8');

    // (1) Walk every `module "X" { ... }` block.
    const modulePattern = /module\s+"([a-z_][a-z0-9_]*)"\s*\{/g;
    let mm;
    while ((mm = modulePattern.exec(content)) !== null) {
      const startIdx = mm.index;
      const openBraceIdx = content.indexOf('{', startIdx);
      const endIdx = matchBraceSafe(content, openBraceIdx);
      if (endIdx === -1) continue;
      modulePattern.lastIndex = endIdx;
      const body = content.slice(openBraceIdx + 1, endIdx);

      // Skip the secret-manager module itself by SOURCE, not by name.
      if (sourceMatches(body, SECRET_MANAGER_SOURCE)) continue;

      collectSecretsFromBody(body, mounted);
    }

    // (2) Walk every `locals { ... }` block and find common_service_secrets.
    const localsPattern = /\blocals\s*\{/g;
    let lm;
    while ((lm = localsPattern.exec(content)) !== null) {
      const startIdx = lm.index;
      const openBraceIdx = content.indexOf('{', startIdx);
      const endIdx = matchBraceSafe(content, openBraceIdx);
      if (endIdx === -1) continue;
      localsPattern.lastIndex = endIdx;
      const body = content.slice(openBraceIdx + 1, endIdx);

      // Find common_service_secrets = { ... }.
      const cssMatch = /\bcommon_service_secrets\s*=\s*\{/.exec(body);
      if (!cssMatch) continue;
      const cssOpenIdx = body.indexOf('{', cssMatch.index);
      const cssEnd = matchBraceLocal(body, cssOpenIdx);
      if (cssEnd === -1) continue;
      const cssBody = body.slice(cssOpenIdx + 1, cssEnd);
      const lhsPattern = /^\s*(INTEXURAOS_[A-Z0-9_]+)\s*=/gm;
      let lm2;
      while ((lm2 = lhsPattern.exec(cssBody)) !== null) {
        mounted.add(lm2[1]);
      }
    }
  }

  return mounted;
}

/**
 * Inside a module body, find every `secrets = { ... }` (or
 * `secrets = merge(local.common_service_secrets, { ... })`) block and harvest
 * the LHS env-var names. References to `local.common_service_secrets` itself
 * are not enough — those are unioned separately via extractMountedSecrets's
 * locals walk — but we DO want to count the inline keys in the merge() second
 * arg.
 */
function collectSecretsFromBody(body, sink) {
  const pattern = /\bsecrets\s*=\s*(\{|merge\s*\()/g;
  let m;
  while ((m = pattern.exec(body)) !== null) {
    if (m[1] === '{') {
      const openIdx = body.indexOf('{', m.index);
      const end = matchBraceLocal(body, openIdx);
      if (end === -1) continue;
      harvestLhs(body.slice(openIdx + 1, end), sink);
    } else {
      // merge( ... ). Walk paren depth, capture every `{ ... }` inside.
      const parenStart = body.indexOf('(', m.index);
      let pdepth = 0;
      let mergeEnd = -1;
      for (let i = parenStart; i < body.length; i++) {
        const ch = body[i];
        if (ch === '(') pdepth++;
        else if (ch === ')') {
          pdepth--;
          if (pdepth === 0) {
            mergeEnd = i;
            break;
          }
        }
      }
      if (mergeEnd === -1) continue;
      const mergeBody = body.slice(parenStart + 1, mergeEnd);
      let i = 0;
      while (i < mergeBody.length) {
        if (mergeBody[i] === '{') {
          const end = matchBraceLocal(mergeBody, i);
          if (end === -1) break;
          harvestLhs(mergeBody.slice(i + 1, end), sink);
          i = end + 1;
        } else {
          i++;
        }
      }
    }
  }
}

function harvestLhs(body, sink) {
  const pattern = /^\s*(INTEXURAOS_[A-Z0-9_]+)\s*=/gm;
  let m;
  while ((m = pattern.exec(body)) !== null) sink.add(m[1]);
}

function main() {
  const tfFiles = listTfFiles(tfDir);
  const declared = extractDeclaredSecrets(tfFiles);

  if (declared.length === 0) {
    console.log('✓ No secrets declared in module "secret_manager"');
    process.exit(0);
  }

  const mounted = extractMountedSecrets(tfFiles);

  const drift = loadKnownDrift(repoRoot);
  const allowlist = drift.terraformSecretMounts ?? {};
  const allowlistedNames = new Set(Object.keys(allowlist));

  // Group by name in case of duplicate declarations.
  const byName = groupByName(declared, 'name');

  const newOrphans = [];
  const stillDrifting = new Set();

  for (const [name, decls] of byName) {
    const isMounted = mounted.has(name);
    const inlineIgnored = decls.some((d) => d.ignoreReason !== null);
    if (isMounted) continue;
    if (inlineIgnored) continue;
    if (allowlistedNames.has(name)) {
      stillDrifting.add(name);
      continue;
    }
    for (const d of decls) {
      newOrphans.push({ name, file: d.file, line: d.line });
    }
  }

  const stale = [];
  for (const name of allowlistedNames) {
    if (!stillDrifting.has(name)) stale.push(name);
  }

  if (newOrphans.length === 0 && stale.length === 0) {
    console.log(`✓ All ${String(byName.size)} declared secrets are mounted by some service`);
    process.exit(0);
  }

  if (newOrphans.length > 0) {
    console.error('❌ orphan secrets in module "secret_manager" (not mounted by any module):');
    for (const o of newOrphans) {
      const rel = o.file.replace(repoRoot + '/', '');
      console.error(`  - ${o.name} (declared at ${rel}:${String(o.line)})`);
    }
    console.error('');
    console.error(
      'FIX: either mount the secret in a cloud-run-service / cloud-function module, OR add it'
    );
    console.error(
      'to scripts/__fixtures__/known-drift.json#terraformSecretMounts with an issue reference.'
    );
  }

  if (stale.length > 0) {
    console.error('❌ stale allowlist entries in known-drift.json#terraformSecretMounts:');
    for (const n of stale) {
      console.error(`  - ${n} (no longer drifting — remove from allowlist)`);
    }
  }

  process.exit(1);
}

main();
