#!/usr/bin/env node
/**
 * Terraform Secret-Mount Verification.
 *
 * Source of truth: every key in the `secrets = { "<NAME>" = "..." }` map of
 * `module "secret_manager"` in `terraform/environments/dev/*.tf`. Each key
 * spawns a `google_secret_manager_secret` via `for_each` in the secret-manager
 * module.
 *
 * Consumer rule: each secret name MUST appear in at least one `secrets = { ... }`
 * block (including `secrets = merge(local.common_service_secrets, { ... })`)
 * attached to a `module "..."` block in the same terraform/environments/dev/*.tf
 * tree, OR in `local.common_service_secrets`. Any cloud-run-service or
 * cloud-function module counts.
 *
 * Orphans not in `known-drift.json#terraformSecretMounts` (or marked with an
 * inline `// verify-terraform-secret-mounts:ignore = reason` comment on the
 * declaration line) cause non-zero exit.
 *
 * Stale allowlist entries (allowlisted name now mounted OR no longer declared)
 * also fail.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadKnownDrift } from './lib/known-drift.mjs';

const repoRoot = process.env.INTEXURAOS_VERIFY_REPO_ROOT
  ? resolve(process.env.INTEXURAOS_VERIFY_REPO_ROOT)
  : resolve(import.meta.dirname, '..');

const tfDir = join(repoRoot, 'terraform', 'environments', 'dev');

const INLINE_IGNORE_PATTERN = /\/\/\s*verify-terraform-secret-mounts:ignore\s*=\s*(.+)$/;

function listTfFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.tf'))
    .map((n) => join(dir, n));
}

/**
 * Find the `module "secret_manager" { ... secrets = { "X" = "...", ... } ... }`
 * block and return declared secret names, with the line number on which they
 * are declared and any inline ignore reason.
 *
 * Returns: Array<{ name, file, line, ignoreReason|null }>
 */
function extractDeclaredSecrets(files) {
  const decls = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');

    // Find `module "secret_manager" {` ... matching `}`.
    const moduleMatch = /module\s+"secret_manager"\s*\{/.exec(content);
    if (!moduleMatch) continue;
    const startIdx = moduleMatch.index;
    const openBraceIdx = content.indexOf('{', startIdx);
    let depth = 0;
    let modEnd = -1;
    for (let i = openBraceIdx; i < content.length; i++) {
      const ch = content[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          modEnd = i;
          break;
        }
      }
    }
    if (modEnd === -1) continue;
    const moduleBody = content.slice(openBraceIdx + 1, modEnd);
    const moduleStartLine = content.slice(0, openBraceIdx).split('\n').length;

    // Inside, find `secrets = {` ... matching `}`.
    const secretsMatch = /secrets\s*=\s*\{/.exec(moduleBody);
    if (!secretsMatch) continue;
    const secretsOpenIdx = moduleBody.indexOf('{', secretsMatch.index);
    depth = 0;
    let secretsEnd = -1;
    for (let i = secretsOpenIdx; i < moduleBody.length; i++) {
      const ch = moduleBody[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          secretsEnd = i;
          break;
        }
      }
    }
    if (secretsEnd === -1) continue;
    const secretsBody = moduleBody.slice(secretsOpenIdx + 1, secretsEnd);
    const secretsBodyStartLine =
      moduleStartLine + moduleBody.slice(0, secretsOpenIdx).split('\n').length - 1;

    const lines = secretsBody.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = /^\s*"(INTEXURAOS_[A-Z0-9_]+)"\s*=/.exec(line);
      if (!m) continue;
      const ignoreMatch = INLINE_IGNORE_PATTERN.exec(line);
      decls.push({
        name: m[1],
        file,
        line: secretsBodyStartLine + i,
        ignoreReason: ignoreMatch ? ignoreMatch[1].trim() : null,
      });
    }
  }
  return decls;
}

/**
 * Collect every secret name *referenced* in any `secrets = { ... }` block
 * inside any `module "..."` block (other than the secret-manager module
 * itself), AND every key inside `local.common_service_secrets = { ... }`.
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
      const moduleName = mm[1];
      if (moduleName === 'secret_manager') continue;
      const startIdx = mm.index;
      const openBraceIdx = content.indexOf('{', startIdx);
      let depth = 0;
      let endIdx = -1;
      for (let i = openBraceIdx; i < content.length; i++) {
        const ch = content[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }
      if (endIdx === -1) continue;
      modulePattern.lastIndex = endIdx;
      const body = content.slice(openBraceIdx + 1, endIdx);
      collectSecretsFromBody(body, mounted);
    }

    // (2) Walk every `locals { ... }` block and find common_service_secrets.
    const localsPattern = /locals\s*\{/g;
    let lm;
    while ((lm = localsPattern.exec(content)) !== null) {
      const startIdx = lm.index;
      const openBraceIdx = content.indexOf('{', startIdx);
      let depth = 0;
      let endIdx = -1;
      for (let i = openBraceIdx; i < content.length; i++) {
        const ch = content[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }
      if (endIdx === -1) continue;
      localsPattern.lastIndex = endIdx;
      const body = content.slice(openBraceIdx + 1, endIdx);

      // Find common_service_secrets = { ... }.
      const cssMatch = /common_service_secrets\s*=\s*\{/.exec(body);
      if (!cssMatch) continue;
      const cssOpenIdx = body.indexOf('{', cssMatch.index);
      let d = 0;
      let cssEnd = -1;
      for (let i = cssOpenIdx; i < body.length; i++) {
        const ch = body[i];
        if (ch === '{') d++;
        else if (ch === '}') {
          d--;
          if (d === 0) {
            cssEnd = i;
            break;
          }
        }
      }
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
  // Find every `secrets = { ... }` start.
  const pattern = /\bsecrets\s*=\s*(\{|merge\s*\()/g;
  let m;
  while ((m = pattern.exec(body)) !== null) {
    // Walk forward to find matching `{` ... `}` for the inline map.
    // For `secrets = { ... }` it's the `{` matched.
    // For `secrets = merge(local.common_service_secrets, { ... })`, scan past
    // the merge( to find the FIRST `{` after the comma at depth-1 inside merge.
    if (m[1] === '{') {
      const openIdx = body.indexOf('{', m.index);
      const end = matchBrace(body, openIdx);
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
      // Capture every top-level `{ ... }` inside merge(...).
      let i = 0;
      while (i < mergeBody.length) {
        if (mergeBody[i] === '{') {
          const end = matchBrace(mergeBody, i);
          if (end === -1) break;
          harvestLhs(mergeBody.slice(i + 1, end), sink);
          i = end + 1;
        } else {
          i++;
        }
      }
    }
  }

  // ALSO: `secrets = local.common_service_secrets` (no merge, no inline) —
  // counted via the locals walk; nothing to harvest here.
}

function matchBrace(src, openIdx) {
  let d = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') d++;
    else if (ch === '}') {
      d--;
      if (d === 0) return i;
    }
  }
  return -1;
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
  const byName = new Map();
  for (const d of declared) {
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d);
  }

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
