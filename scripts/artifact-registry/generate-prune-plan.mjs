#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createPrunePlan,
  DEFAULT_LOCATION,
  DEFAULT_PROJECT_ID,
  DEFAULT_REPOSITORY,
  normalizeDigest,
  parseCommaSeparatedList,
  readJsonFile,
  renderPrunePlanSummary,
  writeJsonFile,
} from './lib.mjs';

function parseArgs(argv) {
  const options = {
    keepCount: 3,
    location: DEFAULT_LOCATION,
    outDir: null,
    project: DEFAULT_PROJECT_ID,
    protectedPath: null,
    repository: DEFAULT_REPOSITORY,
    retiredPackages: [],
  };

  for (const arg of argv) {
    if (arg.startsWith('--project=')) {
      options.project = arg.slice('--project='.length);
      continue;
    }
    if (arg.startsWith('--location=')) {
      options.location = arg.slice('--location='.length);
      continue;
    }
    if (arg.startsWith('--repository=')) {
      options.repository = arg.slice('--repository='.length);
      continue;
    }
    if (arg.startsWith('--keep-count=')) {
      options.keepCount = Number.parseInt(arg.slice('--keep-count='.length), 10);
      continue;
    }
    if (arg.startsWith('--protected=')) {
      options.protectedPath = arg.slice('--protected='.length);
      continue;
    }
    if (arg.startsWith('--retired-packages=')) {
      options.retiredPackages = parseCommaSeparatedList(arg.slice('--retired-packages='.length));
      continue;
    }
    if (arg.startsWith('--out-dir=')) {
      options.outDir = arg.slice('--out-dir='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.protectedPath) {
    throw new Error('Missing required argument: --protected');
  }
  if (!options.outDir) {
    throw new Error('Missing required argument: --out-dir');
  }

  return options;
}

function loadRegistryVersions({ location, project, repository }) {
  return JSON.parse(
    execFileSync(
      'gcloud',
      [
        'artifacts',
        'docker',
        'images',
        'list',
        `${location}-docker.pkg.dev/${project}/${repository}`,
        '--include-tags',
        '--format=json',
      ],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 }
    )
  );
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const protectedDigests = readJsonFile(options.protectedPath).map(normalizeDigest);
  const warningsPath = path.join(path.dirname(options.protectedPath), 'warnings.json');
  const warnings = fs.existsSync(warningsPath) ? readJsonFile(warningsPath) : [];

  const plan = createPrunePlan({
    keepCount: options.keepCount,
    location: options.location,
    projectId: options.project,
    protectedDigests,
    repository: options.repository,
    retiredPackages: options.retiredPackages,
    versions: loadRegistryVersions({
      location: options.location,
      project: options.project,
      repository: options.repository,
    }),
    warnings,
  });

  fs.mkdirSync(options.outDir, { recursive: true });
  writeJsonFile(path.join(options.outDir, 'prune-plan.json'), plan);
  fs.writeFileSync(path.join(options.outDir, 'prune-summary.md'), renderPrunePlanSummary(plan));
  return 0;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  main().then(
    (exitCode) => {
      process.exit(exitCode);
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  );
}
