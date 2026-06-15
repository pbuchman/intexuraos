#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LOCATION,
  DEFAULT_ORCHESTRATOR_IMAGE,
  DEFAULT_PROJECT_ID,
  DEFAULT_REPOSITORY,
  normalizeDigest,
  parseArtifactImageRef,
  parseCommaSeparatedList,
  writeJsonFile,
} from './lib.mjs';

function parseArgs(argv) {
  const options = {
    location: DEFAULT_LOCATION,
    orchestratorEnvPath: '~/.code-orchestrator/env',
    outDir: null,
    project: DEFAULT_PROJECT_ID,
    repository: DEFAULT_REPOSITORY,
  };

  for (const arg of argv) {
    if (arg.startsWith('--project=')) {
      options.project = arg.slice('--project='.length);
      continue;
    }
    if (arg.startsWith('--region=')) {
      options.location = arg.slice('--region='.length);
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
    if (arg.startsWith('--out-dir=')) {
      options.outDir = arg.slice('--out-dir='.length);
      continue;
    }
    if (arg.startsWith('--orchestrator-env-path=')) {
      options.orchestratorEnvPath = arg.slice('--orchestrator-env-path='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.outDir) {
    throw new Error('Missing required argument: --out-dir');
  }

  return options;
}

function runJsonCommand(command, args) {
  return JSON.parse(execFileSync(command, args, { encoding: 'utf8' }));
}

function expandHome(pathname) {
  if (pathname.startsWith('~/')) {
    return path.join(os.homedir(), pathname.slice(2));
  }
  return pathname;
}

function readOrchestratorImageSetting(orchestratorEnvPath) {
  const content = fs.readFileSync(expandHome(orchestratorEnvPath), 'utf8');
  const line = content
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('INTEXURAOS_CODE_WORKER_IMAGE='));

  if (!line) {
    return {
      image: DEFAULT_ORCHESTRATOR_IMAGE,
      source: 'default',
      warning:
        'INTEXURAOS_CODE_WORKER_IMAGE is unset in ~/.code-orchestrator/env; orchestrator still follows code-worker:latest and must be pinned before code-worker prune execution.',
    };
  }

  return {
    image: line.slice('INTEXURAOS_CODE_WORKER_IMAGE='.length),
    source: 'env',
    warning: null,
  };
}

function resolveDigestFromTag({ location, packageName, project, repository, tag }) {
  const versions = runJsonCommand('gcloud', [
    'artifacts',
    'docker',
    'images',
    'list',
    `${location}-docker.pkg.dev/${project}/${repository}/${packageName}`,
    '--include-tags',
    '--format=json',
  ]);

  const match = versions.find(
    (version) => Array.isArray(version.tags) && version.tags.includes(tag)
  );
  if (!match) {
    throw new Error(`Unable to resolve tag ${tag} for package ${packageName}`);
  }

  return normalizeDigest(match.version);
}

function resolveCloudRunImages({ location, project }) {
  const services = runJsonCommand('gcloud', [
    'run',
    'services',
    'list',
    `--region=${location}`,
    `--project=${project}`,
    '--format=json',
  ]);

  return services.map((service) => {
    const revisionName = service.status?.latestReadyRevisionName;
    if (typeof revisionName !== 'string' || revisionName.length === 0) {
      throw new Error(
        `Service ${service.metadata?.name ?? 'unknown'} has no latest ready revision`
      );
    }

    const revision = runJsonCommand('gcloud', [
      'run',
      'revisions',
      'describe',
      revisionName,
      `--region=${location}`,
      `--project=${project}`,
      '--format=json',
    ]);

    const image = revision.spec?.containers?.[0]?.image;
    if (typeof image !== 'string') {
      throw new Error(`Revision ${revisionName} has no container image`);
    }
    const parsed = parseArtifactImageRef(image);
    if (!parsed.digest) {
      throw new Error(`Revision ${revisionName} is not digest-pinned: ${image}`);
    }

    return {
      digest: parsed.digest,
      image,
      packageName: parsed.packageName,
      runtimeName: service.metadata?.name ?? revisionName,
      source: 'cloud-run',
    };
  });
}

function resolveOrchestratorImage({ location, orchestratorEnvPath, project, repository }) {
  const setting = readOrchestratorImageSetting(orchestratorEnvPath);
  const parsed = parseArtifactImageRef(setting.image);
  const digest =
    parsed.digest ??
    resolveDigestFromTag({
      location,
      packageName: parsed.packageName,
      project,
      repository,
      tag: parsed.tag,
    });

  return {
    digest,
    image: setting.image,
    packageName: parsed.packageName,
    runtimeName: 'orchestrator',
    source: 'orchestrator',
    warning: setting.warning,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  fs.mkdirSync(options.outDir, { recursive: true });

  const cloudRunImages = resolveCloudRunImages({
    location: options.location,
    project: options.project,
  });
  const orchestratorImage = resolveOrchestratorImage({
    location: options.location,
    orchestratorEnvPath: options.orchestratorEnvPath,
    project: options.project,
    repository: options.repository,
  });

  const warnings = parseCommaSeparatedList(orchestratorImage.warning ?? '');
  const protectedDigests = [
    ...new Set([...cloudRunImages, orchestratorImage].map((item) => item.digest)),
  ].sort();

  writeJsonFile(path.join(options.outDir, 'cloud-run-images.json'), cloudRunImages);
  writeJsonFile(path.join(options.outDir, 'orchestrator-image.json'), orchestratorImage);
  writeJsonFile(path.join(options.outDir, 'protected-digests.json'), protectedDigests);
  writeJsonFile(path.join(options.outDir, 'warnings.json'), warnings);
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
