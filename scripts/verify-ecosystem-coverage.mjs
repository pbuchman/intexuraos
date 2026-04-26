#!/usr/bin/env node
/**
 * Ecosystem & validateRequiredEnv Coverage Verification.
 *
 * Two assertions:
 *
 * (a) Ecosystem coverage:
 *     Every `module "<x>" { source = "../../modules/cloud-run-service" ... }`
 *     in `terraform/environments/dev/*.tf` MUST have a matching
 *     `createServiceConfig('<short-name>', ...)` in `ecosystem.config.cjs`.
 *     The Terraform service name is `local.services.<key>.name = "intexuraos-<short>"`.
 *     Allowlist key: full Terraform service name (e.g. "intexuraos-api-docs-hub").
 *
 * (b) validateRequiredEnv coverage:
 *     Every directory under apps/ that has src/index.ts AND a corresponding
 *     Terraform cloud-run-service module MUST contain a literal
 *     `validateRequiredEnv(` in its src/index.ts.
 *     Allowlist key: app dir (e.g. "apps/api-docs-hub").
 *     Skips apps/web entirely (Vite dev server, no Fastify lifecycle).
 *
 * Stale allowlist entries fail to prevent allowlist rot.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadKnownDrift } from './lib/known-drift.mjs';

const repoRoot = process.env.INTEXURAOS_VERIFY_REPO_ROOT
  ? resolve(process.env.INTEXURAOS_VERIFY_REPO_ROOT)
  : resolve(import.meta.dirname, '..');

const tfDir = join(repoRoot, 'terraform', 'environments', 'dev');
const appsDir = join(repoRoot, 'apps');
const ecosystemPath = join(repoRoot, 'ecosystem.config.cjs');

function listTfFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.tf'))
    .map((n) => join(dir, n));
}

/**
 * Walk `src` from a `{` index and find the matching `}`. Tracks nested
 * braces via a depth counter — sufficient for HCL where strings are unlikely
 * to contain unescaped `{`/`}`. Returns -1 on no match.
 */
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

/**
 * Parse the `locals { services = { key = { name = "intexuraos-foo" ... } } }`
 * block(s) from any .tf file. Returns a map { localKey: terraformServiceName }.
 *
 * Uses a brace-walker to find each entry's body (resilient to nested
 * `env_vars = { ... }` maps inside the entry, unlike a `[^}]*?` regex).
 */
function extractServicesLocals(files) {
  const services = new Map();

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    // Find `services = {` ... matching `}` at top level.
    const startIdx = content.indexOf('services = {');
    if (startIdx === -1) continue;
    const openBraceIdx = content.indexOf('{', startIdx);
    const endIdx = matchBrace(content, openBraceIdx);
    if (endIdx === -1) continue;
    const block = content.slice(openBraceIdx + 1, endIdx);

    // Walk each top-level entry: `key = { ... }`.
    const entryHead = /([a-z_][a-z0-9_]*)\s*=\s*\{/g;
    let m;
    while ((m = entryHead.exec(block)) !== null) {
      const entryOpenIdx = block.indexOf('{', m.index);
      const entryEnd = matchBrace(block, entryOpenIdx);
      if (entryEnd === -1) continue;
      entryHead.lastIndex = entryEnd;
      const entryBody = block.slice(entryOpenIdx + 1, entryEnd);
      const nameMatch = /\bname\s*=\s*"(intexuraos-[a-z0-9-]+)"/.exec(entryBody);
      if (nameMatch) {
        services.set(m[1], nameMatch[1]);
      }
    }
  }
  return services;
}

/**
 * Find all module blocks whose source is `../../modules/cloud-run-service`.
 * For each, return the resolved Terraform service name. The name comes from
 * either inline `service_name = "intexuraos-foo"` OR
 * `service_name = local.services.<key>.name` resolved via the locals map.
 *
 * If neither resolves, the script FAILS LOUDLY (process.exit(1)) — silent
 * derivation by guessing the module name was a footgun (allowed typoed
 * Terraform to pass).
 */
function extractCloudRunServices(files, localsMap) {
  const moduleStartPattern = /module\s+"([a-z_][a-z0-9_]*)"\s*\{/g;
  const services = []; // {moduleName, terraformName, file, line}

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    let m;
    while ((m = moduleStartPattern.exec(content)) !== null) {
      const moduleName = m[1];
      const startIdx = m.index;
      const openBraceIdx = content.indexOf('{', startIdx);
      const endIdx = matchBrace(content, openBraceIdx);
      if (endIdx === -1) continue;
      const block = content.slice(openBraceIdx + 1, endIdx);
      moduleStartPattern.lastIndex = endIdx;

      if (!/source\s*=\s*"\.\.\/\.\.\/modules\/cloud-run-service"/.test(block)) continue;

      // Resolve service name. Inline literal first, then locals lookup.
      let terraformName = null;
      const inlineMatch = /service_name\s*=\s*"(intexuraos-[a-z0-9-]+)"/.exec(block);
      const localMatch = /service_name\s*=\s*local\.services\.([a-z_][a-z0-9_]*)\.name/.exec(block);
      if (inlineMatch) {
        terraformName = inlineMatch[1];
      } else if (localMatch) {
        terraformName = localsMap.get(localMatch[1]) ?? null;
      }
      if (!terraformName) {
        const rel = file.replace(repoRoot + '/', '');
        const lineNo = content.slice(0, startIdx).split('\n').length;
        console.error(
          `❌ could not resolve service_name for module "${moduleName}" in ${rel}:${String(lineNo)}`
        );
        console.error(
          'FIX: set `service_name = "intexuraos-<name>"` inline OR `service_name = local.services.<key>.name` with a matching locals entry.'
        );
        process.exit(1);
      }

      const lineNo = content.slice(0, startIdx).split('\n').length;
      services.push({ moduleName, terraformName, file, line: lineNo });
    }
  }
  return services;
}

function extractEcosystemServiceNames() {
  if (!existsSync(ecosystemPath)) return new Set();
  const content = readFileSync(ecosystemPath, 'utf8');
  const names = new Set();
  const pattern = /createServiceConfig\(\s*['"]([a-z0-9-]+)['"]/g;
  let m;
  while ((m = pattern.exec(content)) !== null) {
    names.add(m[1]);
  }
  // Also include the literal `name: 'web'` block (web app uses inline config).
  const webPattern = /name:\s*['"]([a-z0-9-]+)['"]/g;
  while ((m = webPattern.exec(content)) !== null) {
    names.add(m[1]);
  }
  return names;
}

function listAppDirs() {
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir).filter((entry) => {
    try {
      return statSync(join(appsDir, entry)).isDirectory();
    } catch {
      return false;
    }
  });
}

function main() {
  const tfFiles = listTfFiles(tfDir);
  const localsMap = extractServicesLocals(tfFiles);
  const cloudRunServices = extractCloudRunServices(tfFiles, localsMap);
  const ecosystemNames = extractEcosystemServiceNames();
  const appDirs = listAppDirs();

  const drift = loadKnownDrift(repoRoot);
  const ecoCoverage = drift.ecosystemCoverage ?? {};
  const allowlistedEco = new Set(Object.keys(ecoCoverage.missingEcosystemEntry ?? {}));
  const allowlistedValidate = new Set(Object.keys(ecoCoverage.missingValidateRequiredEnv ?? {}));

  const errors = [];
  const stale = [];

  // (a) Ecosystem coverage.
  const driftingEcoNames = new Set();
  for (const svc of cloudRunServices) {
    const shortName = svc.terraformName.replace(/^intexuraos-/, '');
    if (ecosystemNames.has(shortName)) continue;
    if (allowlistedEco.has(svc.terraformName)) {
      driftingEcoNames.add(svc.terraformName);
      continue;
    }
    errors.push(
      `ecosystem-coverage: ${svc.terraformName} (Terraform module "${svc.moduleName}") missing createServiceConfig('${shortName}', ...) in ecosystem.config.cjs`
    );
  }
  for (const name of allowlistedEco) {
    if (!driftingEcoNames.has(name)) {
      // Either no longer in TF or now in ecosystem.
      stale.push(`ecosystem-coverage: stale allowlist entry: ${name}`);
    }
  }

  // (b) validateRequiredEnv coverage.
  const tfShortNames = new Set(
    cloudRunServices.map((s) => s.terraformName.replace(/^intexuraos-/, ''))
  );
  const driftingValidate = new Set();
  for (const dir of appDirs) {
    if (dir === 'web') continue;
    const indexPath = join(appsDir, dir, 'src', 'index.ts');
    if (!existsSync(indexPath)) continue;
    if (!tfShortNames.has(dir)) continue; // app has no Terraform module → skip
    const content = readFileSync(indexPath, 'utf8');
    if (content.includes('validateRequiredEnv(')) continue;
    const key = `apps/${dir}`;
    if (allowlistedValidate.has(key)) {
      driftingValidate.add(key);
      continue;
    }
    errors.push(
      `validateRequiredEnv: ${key}/src/index.ts is missing validateRequiredEnv(...) call`
    );
  }
  for (const key of allowlistedValidate) {
    if (!driftingValidate.has(key)) {
      stale.push(`validateRequiredEnv: stale allowlist entry: ${key}`);
    }
  }

  if (errors.length === 0 && stale.length === 0) {
    console.log(
      `✓ ecosystem-coverage: ${String(cloudRunServices.length)} cloud-run modules; validateRequiredEnv: ${String(tfShortNames.size)} apps checked`
    );
    process.exit(0);
  }

  if (errors.length > 0) {
    console.error('❌ ecosystem coverage drift:');
    for (const e of errors) console.error(`  - ${e}`);
    console.error('');
    console.error(
      'FIX: either add the missing entry to ecosystem.config.cjs / src/index.ts, OR add the'
    );
    console.error(
      'allowlist entry to scripts/__fixtures__/known-drift.json#ecosystemCoverage with an issue reference.'
    );
  }
  if (stale.length > 0) {
    console.error('❌ stale allowlist entries:');
    for (const s of stale) console.error(`  - ${s}`);
  }
  process.exit(1);
}

main();
