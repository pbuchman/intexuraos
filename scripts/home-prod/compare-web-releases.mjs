#!/usr/bin/env node

import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

function sameEntry(candidate, existing) {
  const candidateStat = lstatSync(candidate);
  const existingStat = lstatSync(existing);
  if (candidateStat.isSymbolicLink() && existingStat.isSymbolicLink()) {
    return readlinkSync(candidate) === readlinkSync(existing);
  }
  if (candidateStat.isFile() && existingStat.isFile()) {
    return (
      candidateStat.size === existingStat.size &&
      readFileSync(candidate).equals(readFileSync(existing))
    );
  }
  if (candidateStat.isDirectory() && existingStat.isDirectory()) {
    const candidateNames = readdirSync(candidate).sort();
    const existingNames = readdirSync(existing).sort();
    return (
      candidateNames.length === existingNames.length &&
      candidateNames.every(
        (name, index) =>
          name === existingNames[index] && sameEntry(join(candidate, name), join(existing, name))
      )
    );
  }
  // Type changes and special files must never be admitted as equivalent.
  return false;
}

try {
  const [candidate, existing] = process.argv.slice(2);
  if (
    process.argv.length !== 4 ||
    !lstatSync(candidate).isDirectory() ||
    !lstatSync(existing).isDirectory() ||
    !sameEntry(candidate, existing)
  ) {
    throw new Error('Web release mismatch');
  }
} catch {
  process.stderr.write('Web release trees differ or cannot be inspected\n');
  process.exit(1);
}
