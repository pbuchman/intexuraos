import fs from 'node:fs';

export const DEFAULT_PROJECT_ID = 'intexuraos-dev-pbuchman';
export const DEFAULT_LOCATION = 'europe-central2';
export const DEFAULT_REPOSITORY = 'intexuraos-dev';
export const DEFAULT_ORCHESTRATOR_IMAGE =
  'europe-central2-docker.pkg.dev/intexuraos-dev-pbuchman/intexuraos-dev/code-worker:latest';

export function parseArtifactImageRef(image) {
  const digestIndex = image.indexOf('@sha256:');
  let base = image;
  let digest = null;
  let tag = null;

  if (digestIndex >= 0) {
    base = image.slice(0, digestIndex);
    digest = image.slice(digestIndex + 1);
  } else {
    const lastSlashIndex = image.lastIndexOf('/');
    const lastColonIndex = image.lastIndexOf(':');
    if (lastColonIndex <= lastSlashIndex) {
      throw new Error(`Artifact image must include a tag or digest: ${image}`);
    }
    base = image.slice(0, lastColonIndex);
    tag = image.slice(lastColonIndex + 1);
  }

  const parts = base.split('/');
  if (parts.length < 4) {
    throw new Error(`Unexpected Artifact Registry image format: ${image}`);
  }

  return {
    digest,
    image,
    packageName: parts.slice(3).join('/'),
    projectId: parts[1],
    registryHost: parts[0],
    repository: parts[2],
    tag,
  };
}

export function normalizeRegistryVersion(version) {
  const packageName = version.package.split('/').at(-1);
  if (!packageName) {
    throw new Error(
      `Unable to determine package from Artifact Registry version: ${version.package}`
    );
  }

  return {
    createTime: version.createTime,
    digest: normalizeDigest(version.version),
    imageSizeBytes: Number.parseInt(version.metadata?.imageSizeBytes ?? '0', 10) || 0,
    packageName,
    tags: Array.isArray(version.tags) ? version.tags : [],
  };
}

export function normalizeDigest(digest) {
  if (!digest.startsWith('sha256:')) {
    return `sha256:${digest.replace(/^sha256:/, '')}`;
  }
  return digest;
}

export function groupVersionsByPackage(versions) {
  const grouped = new Map();

  for (const version of versions) {
    const existing = grouped.get(version.packageName) ?? [];
    existing.push(version);
    grouped.set(version.packageName, existing);
  }

  return grouped;
}

export function classifyPackages(packageNames, retiredPackages) {
  const retiredSet = new Set(retiredPackages);
  return packageNames.map((packageName) => ({
    packageName,
    status: retiredSet.has(packageName) ? 'retired' : 'active',
  }));
}

export function buildRetentionDecisions({
  keepCount,
  protectedDigests,
  retiredPackages,
  versions,
}) {
  const protectedSet = new Set(protectedDigests.map(normalizeDigest));
  const retiredSet = new Set(retiredPackages);
  const grouped = groupVersionsByPackage(versions);
  const decisions = [];

  for (const [packageName, packageVersions] of [...grouped.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const sortedVersions = [...packageVersions].sort((left, right) =>
      right.createTime.localeCompare(left.createTime)
    );
    const sortedDigests = sortedVersions.map((version) => normalizeDigest(version.digest));
    const status = retiredSet.has(packageName) ? 'retired' : 'active';

    let keepDigests = [];
    if (status === 'active') {
      keepDigests = sortedDigests.slice(0, keepCount);
      for (const digest of sortedDigests) {
        if (protectedSet.has(digest) && !keepDigests.includes(digest)) {
          keepDigests.push(digest);
        }
      }
    }

    const keepSet = new Set(keepDigests);
    const deleteDigests =
      status === 'retired' ? sortedDigests : sortedDigests.filter((digest) => !keepSet.has(digest));

    for (const digest of deleteDigests) {
      if (protectedSet.has(digest)) {
        throw new Error(
          `Refusing to delete protected digest ${digest} from package ${packageName}`
        );
      }
    }

    const deleteVersions = sortedVersions.filter((version) =>
      deleteDigests.includes(normalizeDigest(version.digest))
    );
    const keepVersions = sortedVersions.filter((version) =>
      keepSet.has(normalizeDigest(version.digest))
    );

    decisions.push({
      deleteDigests,
      deleteLogicalBytes: deleteVersions.reduce(
        (total, version) => total + version.imageSizeBytes,
        0
      ),
      deleteVersions,
      keepDigests,
      keepLogicalBytes: keepVersions.reduce((total, version) => total + version.imageSizeBytes, 0),
      keepVersions,
      packageName,
      status,
    });
  }

  return decisions;
}

export function createPrunePlan({
  generatedAt = new Date().toISOString(),
  keepCount,
  location = DEFAULT_LOCATION,
  projectId = DEFAULT_PROJECT_ID,
  protectedDigests,
  repository = DEFAULT_REPOSITORY,
  retiredPackages,
  versions,
  warnings = [],
}) {
  const normalizedProtectedDigests = [...new Set(protectedDigests.map(normalizeDigest))].sort();
  const normalizedVersions = versions.map(normalizeRegistryVersion);
  const packageDecisions = buildRetentionDecisions({
    keepCount,
    protectedDigests: normalizedProtectedDigests,
    retiredPackages,
    versions: normalizedVersions,
  });

  return {
    deleteDigestCount: packageDecisions.reduce(
      (total, decision) => total + decision.deleteDigests.length,
      0
    ),
    deleteLogicalBytes: packageDecisions.reduce(
      (total, decision) => total + decision.deleteLogicalBytes,
      0
    ),
    deletePackageCount: packageDecisions.filter((decision) => decision.deleteDigests.length > 0)
      .length,
    generatedAt,
    keepCount,
    location,
    packageDecisions,
    projectId,
    protectedDigests: normalizedProtectedDigests,
    repository,
    retiredPackages: [...retiredPackages].sort(),
    warnings,
  };
}

export function renderPrunePlanSummary(plan) {
  const lines = [
    '# Artifact Registry Prune Summary',
    '',
    `Generated: ${plan.generatedAt}`,
    `Repository: ${plan.location}-docker.pkg.dev/${plan.projectId}/${plan.repository}`,
    `Keep count: ${String(plan.keepCount)}`,
    `Protected digests: ${String(plan.protectedDigests.length)}`,
    `Delete digests: ${String(plan.deleteDigestCount)}`,
    `Delete logical bytes: ${formatBytes(plan.deleteLogicalBytes)}`,
    '',
    '| Package | Status | Keep | Delete | Logical Delete |',
    '| --- | --- | ---: | ---: | ---: |',
  ];

  for (const decision of [...plan.packageDecisions].sort(
    (left, right) => right.deleteLogicalBytes - left.deleteLogicalBytes
  )) {
    lines.push(
      `| ${decision.packageName} | ${decision.status} | ${String(decision.keepDigests.length)} | ${String(
        decision.deleteDigests.length
      )} | ${formatBytes(decision.deleteLogicalBytes)} |`
    );
  }

  if (plan.warnings.length > 0) {
    lines.push('', '## Warnings', '');
    for (const warning of plan.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function selectPackageDecisions(plan, scope) {
  if (scope === 'all') {
    return plan.packageDecisions;
  }

  if (scope === 'retired-packages') {
    return plan.packageDecisions.filter((decision) => decision.status === 'retired');
  }

  if (scope.startsWith('package:')) {
    const packageName = scope.slice('package:'.length);
    return plan.packageDecisions.filter((decision) => decision.packageName === packageName);
  }

  throw new Error(`Unsupported prune scope: ${scope}`);
}

export function buildDeleteCommands(plan, scope = 'retired-packages') {
  const protectedSet = new Set(plan.protectedDigests.map(normalizeDigest));
  const selectedDecisions = selectPackageDecisions(plan, scope);
  const commands = [];

  for (const decision of selectedDecisions) {
    for (const digest of decision.deleteDigests.map(normalizeDigest)) {
      if (protectedSet.has(digest)) {
        throw new Error(
          `Refusing to delete protected digest ${digest} from package ${decision.packageName}`
        );
      }

      commands.push({
        command: renderDeleteCommand({
          digest,
          location: plan.location ?? DEFAULT_LOCATION,
          packageName: decision.packageName,
          projectId: plan.projectId ?? DEFAULT_PROJECT_ID,
          repository: plan.repository ?? DEFAULT_REPOSITORY,
        }),
        digest,
        packageName: decision.packageName,
      });
    }
  }

  return commands;
}

export function renderDeleteCommand({ digest, location, packageName, projectId, repository }) {
  return [
    'gcloud artifacts docker images delete',
    `${location}-docker.pkg.dev/${projectId}/${repository}/${packageName}@${normalizeDigest(digest)}`,
    '--delete-tags',
    '--quiet',
  ].join(' ');
}

export function readJsonFile(pathname) {
  return JSON.parse(fs.readFileSync(pathname, 'utf8'));
}

export function writeJsonFile(pathname, value) {
  fs.writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`);
}

export function parseCommaSeparatedList(value) {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function formatBytes(bytes) {
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}
