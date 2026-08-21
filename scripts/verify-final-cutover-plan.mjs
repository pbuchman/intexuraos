#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultManifestPath = resolve(repoRoot, 'config/environments/final-secret-cutover.json');

export function loadFinalCutoverManifest(path = defaultManifestPath) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  validateManifest(manifest);
  return manifest;
}

export function expectedStageActions(manifest, stage) {
  if (stage === 'devObsoleteDelete') {
    const prefix = manifest.terraformStages.devObsoleteDelete.derivedLegacySecretAddressPrefix;
    return [
      ...manifest.legacySecretNames.map((name) => ({
        address: `${prefix}[${JSON.stringify(name)}]`,
        actions: ['delete'],
      })),
      ...manifest.terraformStages.devObsoleteDelete.additionalActions,
    ];
  }
  const contract = manifest.terraformStages[stage];
  if (contract === undefined) throw new Error('FINAL_CUTOVER_STAGE_INVALID');
  return contract.actions ?? [];
}

export function validateFinalCutoverPlan({ manifest, plan, stage }) {
  validateManifest(manifest);
  if (!isRecord(plan) || !Array.isArray(plan.resource_changes)) {
    throw new Error('FINAL_CUTOVER_PLAN_INVALID');
  }
  const observed = normalizeResourceChanges(plan.resource_changes);
  const outputs = normalizeOutputChanges(plan.output_changes);

  if (stage === 'remaining') {
    const allowed = new Map(
      [
        ...expectedStageActions(manifest, 'cloudBuildAdminDelete'),
        ...expectedStageActions(manifest, 'devObsoleteDelete'),
        ...expectedStageActions(manifest, 'hetznerLegacyDelete'),
        ...manifest.excludedTerraformActions,
      ].map((entry) => [entry.address, entry.actions.join(',')])
    );
    for (const [address, actions] of observed) {
      if (allowed.get(address) !== actions.join(',')) {
        throw new Error('FINAL_CUTOVER_PLAN_UNEXPECTED_ACTION');
      }
    }
    const allowedOutputs = new Set(
      manifest.terraformStages.hetznerLegacyDelete.allowedOutputDeletes
    );
    for (const [name, actions] of outputs) {
      if (!allowedOutputs.has(name) || actions.join(',') !== 'delete') {
        throw new Error('FINAL_CUTOVER_PLAN_UNEXPECTED_OUTPUT');
      }
    }
    return { resourceActions: observed.size, outputActions: outputs.size };
  }

  const contract = manifest.terraformStages[stage];
  if (contract === undefined) throw new Error('FINAL_CUTOVER_STAGE_INVALID');
  const alternatives = contract.allowedActionSets ?? [expectedStageActions(manifest, stage)];
  if (!alternatives.some((expected) => mapsEqual(observed, actionMap(expected)))) {
    throw new Error('FINAL_CUTOVER_PLAN_ACTION_SET_MISMATCH');
  }
  const allowedOutputDeletes = new Set(contract.allowedOutputDeletes ?? []);
  if (
    outputs.size !== allowedOutputDeletes.size ||
    [...outputs].some(
      ([name, actions]) => !allowedOutputDeletes.has(name) || actions.join(',') !== 'delete'
    )
  ) {
    throw new Error('FINAL_CUTOVER_PLAN_OUTPUT_SET_MISMATCH');
  }
  return { resourceActions: observed.size, outputActions: outputs.size };
}

function validateManifest(manifest) {
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== 1 ||
    manifest.projectId !== 'intexuraos-dev-pbuchman' ||
    !isRecord(manifest.state) ||
    !/^[0-9a-f-]{36}$/u.test(manifest.state.lineage) ||
    !Number.isInteger(manifest.state.baselineSerial) ||
    !Array.isArray(manifest.legacySecretNames) ||
    manifest.legacySecretNames.length !== 34 ||
    new Set(manifest.legacySecretNames).size !== 34 ||
    !isRecord(manifest.terraformStages) ||
    !Array.isArray(manifest.excludedTerraformActions) ||
    manifest.excludedTerraformActions.length !== 2 ||
    !Array.isArray(manifest.retainedTerraformAddresses)
  ) {
    throw new Error('FINAL_CUTOVER_MANIFEST_INVALID');
  }
  if ([...manifest.legacySecretNames].sort().join('\0') !== manifest.legacySecretNames.join('\0')) {
    throw new Error('FINAL_CUTOVER_MANIFEST_INVALID');
  }
  const allDeletes = expectedStageActions(manifest, 'devObsoleteDelete');
  if (
    allDeletes.length !== 36 ||
    allDeletes.some((entry) => entry.actions.join(',') !== 'delete')
  ) {
    throw new Error('FINAL_CUTOVER_MANIFEST_INVALID');
  }
  const retained = new Set(manifest.retainedTerraformAddresses);
  if (allDeletes.some((entry) => retained.has(entry.address))) {
    throw new Error('FINAL_CUTOVER_MANIFEST_INVALID');
  }
}

function normalizeResourceChanges(changes) {
  const result = new Map();
  for (const resource of changes) {
    if (!isRecord(resource) || typeof resource.address !== 'string' || !isRecord(resource.change)) {
      throw new Error('FINAL_CUTOVER_PLAN_INVALID');
    }
    const actions = resource.change.actions;
    if (!Array.isArray(actions) || actions.some((action) => typeof action !== 'string')) {
      throw new Error('FINAL_CUTOVER_PLAN_INVALID');
    }
    if (actions.length === 1 && actions[0] === 'no-op') continue;
    if (result.has(resource.address)) throw new Error('FINAL_CUTOVER_PLAN_INVALID');
    result.set(resource.address, actions);
  }
  return result;
}

function normalizeOutputChanges(changes) {
  if (changes === undefined) return new Map();
  if (!isRecord(changes)) throw new Error('FINAL_CUTOVER_PLAN_INVALID');
  const result = new Map();
  for (const [name, change] of Object.entries(changes)) {
    if (!isRecord(change) || !Array.isArray(change.actions)) {
      throw new Error('FINAL_CUTOVER_PLAN_INVALID');
    }
    if (change.actions.length === 1 && change.actions[0] === 'no-op') continue;
    result.set(name, change.actions);
  }
  return result;
}

function actionMap(actions) {
  return new Map(actions.map((entry) => [entry.address, entry.actions]));
}

function mapsEqual(left, right) {
  return (
    left.size === right.size &&
    [...left].every(([address, actions]) => actions.join(',') === right.get(address)?.join(','))
  );
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error('FINAL_CUTOVER_ARGUMENTS_INVALID');
    }
    result[key.slice(2)] = value;
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadFinalCutoverManifest(args.manifest);
  if (!args.stage || !args['plan-json'] || !args['plan-file'] || !args['state-metadata']) {
    throw new Error('FINAL_CUTOVER_ARGUMENTS_INVALID');
  }
  const plan = JSON.parse(readFileSync(args['plan-json'], 'utf8'));
  const state = JSON.parse(readFileSync(args['state-metadata'], 'utf8'));
  if (
    state.lineage !== manifest.state.lineage ||
    !Number.isInteger(state.serial) ||
    state.serial < manifest.state.baselineSerial
  ) {
    throw new Error('FINAL_CUTOVER_STATE_IDENTITY_MISMATCH');
  }
  const result = validateFinalCutoverPlan({ manifest, plan, stage: args.stage });
  const planSha256 = createHash('sha256').update(readFileSync(args['plan-file'])).digest('hex');
  process.stdout.write(
    `${JSON.stringify({
      stage: args.stage,
      lineage: state.lineage,
      serial: state.serial,
      planSha256,
      ...result,
    })}\n`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
