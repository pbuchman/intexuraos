#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const FAILURE = 'SECRET_PACKAGE_VERSION_PINS_MISMATCH';
const positiveVersionPattern = /^[1-9][0-9]*$/;

function reject() {
  process.stderr.write(`${FAILURE}\n`);
  process.exit(1);
}

function positiveInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

const [expectedVersion, manifestPath, terraformInputsPath, ...unexpected] = process.argv.slice(2);

if (
  unexpected.length > 0 ||
  typeof expectedVersion !== 'string' ||
  !positiveVersionPattern.test(expectedVersion) ||
  typeof manifestPath !== 'string' ||
  manifestPath.length === 0 ||
  typeof terraformInputsPath !== 'string' ||
  terraformInputsPath.length === 0
) {
  reject();
}

try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const terraformInputs = JSON.parse(readFileSync(terraformInputsPath, 'utf8'));
  const manifestVersion = manifest?.packages?.prod?.stableVersion;
  const terraformVersion = terraformInputs?.prod_secret_package_version;

  if (
    manifest?.schemaVersion !== 1 ||
    !positiveInteger(manifestVersion) ||
    !positiveInteger(terraformVersion) ||
    String(manifestVersion) !== expectedVersion ||
    String(terraformVersion) !== expectedVersion
  ) {
    reject();
  }
} catch {
  reject();
}

process.stdout.write(
  `${JSON.stringify({ environment: 'prod', status: 'MATCH', version: expectedVersion })}\n`
);
