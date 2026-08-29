import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parse } from 'dotenv';
import { buildSync } from 'esbuild';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const generatorPath = resolve(repoRoot, 'scripts/generate-orchestrator-env.mjs');
const identityAuditPath = resolve(
  repoRoot,
  'config/environments/orchestrator-home-dev-identity-audit.json'
);
const identityDecisionPath = resolve(repoRoot, 'docs/operations/orchestrator-identity-decision.md');

function generatorEnvironment(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    PROJECT_ID: 'intexuraos-dev-pbuchman',
    INTEXURAOS_CODE_AGENT_URL: 'http://localhost:8128',
    INTEXURAOS_ENVIRONMENT: 'prod',
    INTEXURAOS_ERROR_HUB_HOST: 'home-dev.example.ts.net:8443',
    INTEXURAOS_GITHUB_APP_ID: '123',
    INTEXURAOS_GITHUB_INSTALLATION_ID: '456',
    INTEXURAOS_INTERNAL_AUTH_TOKEN: 'internal-token',
    INTEXURAOS_LINEAR_API_KEY: 'linear-token',
    INTEXURAOS_OPENROUTER_APP_API_KEY: 'openrouter-token',
    INTEXURAOS_ORCHESTRATOR_SECRET: 'orchestrator-token',
    INTEXURAOS_REPOSITORY_URL: 'https://github.com/pbuchman/intexuraos.git',
    INTEXURAOS_RUNTIME: 'prod',
    INTEXURAOS_USAGE_WEBHOOK_URL:
      'https://dev.intexuraos.cloud/api/code/internal/webhooks/usage-events',
  };
}

interface IdentityAudit {
  schemaVersion: number;
  scope: string;
  callbackOwner: Record<string, { value: string; valueClass: string }>;
  fixedTags: Record<string, { value: string; valueClass: string }>;
  runtimeWorkspaceClosure: RuntimeWorkspaceClosure;
  runtimeBundleClosure: RuntimeBundleClosure;
  observabilityIdentityBoundary: ObservabilityIdentityBoundary;
  literalReferences: IdentityLiteralReference[];
  consumers: ReviewedIdentityConsumer[];
  routingAuthorities: string[];
  credentialAuthorities: string[];
  pendingLiveGates: string[];
}

interface IdentityLiteralReference {
  envName: IdentityTagName;
  file: string;
  line: number;
  column: number;
  nodeKind: 'Identifier' | 'StringLiteral';
  reviewedSha256: string;
}

interface ReviewedIdentityConsumer {
  envName: IdentityTagName;
  file: string;
  purpose: string;
  routingAuthority: false;
  sinkClassification: IdentitySinkClassification;
  reviewedSha256: string;
  usageBindings: IdentityUsageBinding[];
}

type IdentityTagName = 'INTEXURAOS_ENVIRONMENT' | 'INTEXURAOS_RUNTIME';

type IdentitySinkClassification =
  | 'generator-fixed-host-observability-tag'
  | 'orchestrator-observability-identity-boundary'
  | 'sentry-environment-forwarder'
  | 'sentry-environment-and-trace-sink'
  | 'sentry-trace-sampling-sink'
  | 'sentry-runtime-tag-sink';

type IdentityUsageClass =
  | 'fixed-value-assignment'
  | 'environment-variable-read'
  | 'observability-bootstrap-forward'
  | 'sentry-config-forward'
  | 'sentry-trace-default-input'
  | 'sentry-environment-option'
  | 'trace-sampling-decision'
  | 'runtime-environment-read'
  | 'sentry-runtime-tag';

interface IdentityUsageBinding {
  usageClass: IdentityUsageClass;
  line: number;
  column: number;
  nodeKind: string;
  spanSha256: string;
}

interface ExpectedIdentityConsumer {
  envName: IdentityTagName;
  file: string;
  purpose: string;
  routingAuthority: false;
  sinkClassification: IdentitySinkClassification;
  usageBindings: IdentityUsageBinding[];
}

interface RuntimeWorkspacePackage {
  name: string;
  packageJson: string;
  workspaceDependencies: string[];
}

interface RuntimeWorkspaceClosure {
  rootPackage: string;
  rootPackageJson: string;
  packages: RuntimeWorkspacePackage[];
}

interface RuntimeBundleClosure {
  entryPoints: string[];
  inputCount: number;
  inputsSha256: string;
}

interface ReviewedBoundaryFile {
  file: string;
  reviewedSha256: string;
}

interface ObservabilityIdentityBoundary {
  bootstrapConfig: ReviewedBoundaryFile & { forbiddenField: 'environment' };
  boundaryModule: ReviewedBoundaryFile & {
    exportName: 'initOrchestratorObservability';
    brandedType: 'ObservabilityEnvironment';
  };
  soleImporter: ReviewedBoundaryFile;
  serviceWiring: ReviewedBoundaryFile;
  sink: {
    module: '@intexuraos/infra-sentry';
    exportName: 'initWorker';
    property: 'environment';
  };
}

interface WorkspacePackageManifest extends RuntimeWorkspacePackage {
  absolutePackageJson: string;
  externalDependencies: string[];
}

const runtimeSourceExtension = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u;
const declarationSourceExtension = /\.d\.(?:cts|mts|ts)$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const orchestratorRuntimeEntryPoints = ['workers/orchestrator/src/index.ts'];
const expectedObservabilityIdentityBoundary = {
  bootstrapConfig: {
    file: 'workers/orchestrator/src/bootstrap/env-config.ts',
    forbiddenField: 'environment',
  },
  boundaryModule: {
    file: 'workers/orchestrator/src/bootstrap/observability-identity.ts',
    exportName: 'initOrchestratorObservability',
    brandedType: 'ObservabilityEnvironment',
  },
  soleImporter: {
    file: 'workers/orchestrator/src/start.ts',
  },
  serviceWiring: {
    file: 'workers/orchestrator/src/bootstrap/service-wiring.ts',
  },
  sink: {
    module: '@intexuraos/infra-sentry',
    exportName: 'initWorker',
    property: 'environment',
  },
} as const;

const expectedScope = 'Home Dev orchestrator generated runtime environment';
const expectedCallbackOwner = {
  INTEXURAOS_CODE_AGENT_URL: {
    value: 'https://intexuraos.cloud/api/code',
    valueClass: 'production-code-agent-base',
  },
  INTEXURAOS_USAGE_WEBHOOK_URL: {
    value: 'https://intexuraos.cloud/api/code/internal/webhooks/usage-events',
    valueClass: 'production-usage-webhook',
  },
};
const expectedFixedTags = {
  INTEXURAOS_ENVIRONMENT: {
    value: 'dev',
    valueClass: 'legacy-host-observability-tag',
  },
  INTEXURAOS_RUNTIME: {
    value: 'dev',
    valueClass: 'legacy-host-observability-tag',
  },
};
const expectedRoutingAuthorities = [
  'task.webhookUrl',
  'INTEXURAOS_CODE_AGENT_URL',
  'INTEXURAOS_USAGE_WEBHOOK_URL',
];
const expectedCredentialAuthorities = [
  'GOOGLE_APPLICATION_CREDENTIALS',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_ORCHESTRATOR_SECRET',
];
const expectedPendingLiveGates = [
  'credential-principal-metadata',
  'prod-hmac-internal-auth-secret-match',
];
const expectedConsumers: ExpectedIdentityConsumer[] = [
  {
    envName: 'INTEXURAOS_ENVIRONMENT',
    file: 'scripts/generate-orchestrator-env.mjs',
    purpose:
      'Pins the legacy physical-host and observability classification in the protected systemd projection.',
    routingAuthority: false,
    sinkClassification: 'generator-fixed-host-observability-tag',
    usageBindings: [
      {
        usageClass: 'fixed-value-assignment',
        line: 136,
        column: 5,
        nodeKind: 'PropertyAssignment',
        spanSha256: '2ac7296a50a4c4848499894fbcc06b6142a96e14f58a509dbfb79ce070299905',
      },
    ],
  },
  {
    envName: 'INTEXURAOS_ENVIRONMENT',
    file: 'workers/orchestrator/src/bootstrap/observability-identity.ts',
    purpose:
      'Reads the legacy host tag into a private branded value and forwards it directly to initWorker observability.',
    routingAuthority: false,
    sinkClassification: 'orchestrator-observability-identity-boundary',
    usageBindings: [
      {
        usageClass: 'environment-variable-read',
        line: 24,
        column: 10,
        nodeKind: 'CallExpression',
        spanSha256: '25f652e22e0e5343aaf39732f589386f6e5e59a4039d257740605fa6df751dce',
      },
      {
        usageClass: 'observability-bootstrap-forward',
        line: 39,
        column: 5,
        nodeKind: 'PropertyAssignment',
        spanSha256: '6a9903de8d249720fffaee9c2e5ed1964e5aedc600d19360bb1d942c41bd212b',
      },
    ],
  },
  {
    envName: 'INTEXURAOS_ENVIRONMENT',
    file: 'packages/infra-sentry/src/initWorker.ts',
    purpose: 'Forwards the supplied environment label to Sentry initialization.',
    routingAuthority: false,
    sinkClassification: 'sentry-environment-forwarder',
    usageBindings: [
      {
        usageClass: 'sentry-config-forward',
        line: 68,
        column: 5,
        nodeKind: 'PropertyAssignment',
        spanSha256: 'b0575086a7bc17f6762d9beeb178b50c32b67040d8a8b7d4a24a95102ceccb05',
      },
    ],
  },
  {
    envName: 'INTEXURAOS_ENVIRONMENT',
    file: 'packages/infra-sentry/src/init.ts',
    purpose: 'Sets the Sentry environment field and selects its tracing default.',
    routingAuthority: false,
    sinkClassification: 'sentry-environment-and-trace-sink',
    usageBindings: [
      {
        usageClass: 'sentry-trace-default-input',
        line: 105,
        column: 55,
        nodeKind: 'CallExpression',
        spanSha256: '99719a4eccd09b67b42debb59c766842f35fa4d67d9be7d6bf75a0b220558af2',
      },
      {
        usageClass: 'sentry-environment-option',
        line: 118,
        column: 5,
        nodeKind: 'BinaryExpression',
        spanSha256: '7fc6a3dfdc50a7a043fe9f065b56ced056730005d885ac1cb2b323558b336dda',
      },
    ],
  },
  {
    envName: 'INTEXURAOS_ENVIRONMENT',
    file: 'packages/infra-sentry/src/runtimeDefaults.ts',
    purpose: 'Maps the observability label to the default Sentry trace sample rate.',
    routingAuthority: false,
    sinkClassification: 'sentry-trace-sampling-sink',
    usageBindings: [
      {
        usageClass: 'trace-sampling-decision',
        line: 25,
        column: 10,
        nodeKind: 'ConditionalExpression',
        spanSha256: 'b728f52b2881feee2caadb0ec14ad13016a4a102d31b73e4d79d9b2d0f00cb2f',
      },
    ],
  },
  {
    envName: 'INTEXURAOS_RUNTIME',
    file: 'scripts/generate-orchestrator-env.mjs',
    purpose: 'Pins the legacy physical runtime label in the protected systemd projection.',
    routingAuthority: false,
    sinkClassification: 'generator-fixed-host-observability-tag',
    usageBindings: [
      {
        usageClass: 'fixed-value-assignment',
        line: 137,
        column: 5,
        nodeKind: 'PropertyAssignment',
        spanSha256: 'e25764a3b9ad592cec1698313a3c2206d3426d5cfc36ebaf035cbec6b8af06b3',
      },
    ],
  },
  {
    envName: 'INTEXURAOS_RUNTIME',
    file: 'packages/infra-sentry/src/init.ts',
    purpose: 'Adds the runtime value as a Sentry event tag.',
    routingAuthority: false,
    sinkClassification: 'sentry-runtime-tag-sink',
    usageBindings: [
      {
        usageClass: 'runtime-environment-read',
        line: 127,
        column: 19,
        nodeKind: 'ElementAccessExpression',
        spanSha256: '93f71303f27535dca746741b283ef3eaba3ef2aeffbb48cabc6a1909bbae299f',
      },
      {
        usageClass: 'sentry-runtime-tag',
        line: 129,
        column: 5,
        nodeKind: 'CallExpression',
        spanSha256: '393c179038de0ff566722c53f27481c69c60284a3ce24bd0e0dfc1f7dc8c100f',
      },
    ],
  },
];
const allowedSinkClassifications = new Set<IdentitySinkClassification>(
  expectedConsumers.map(({ sinkClassification }) => sinkClassification)
);
const allowedUsageClassesBySink: Record<IdentitySinkClassification, IdentityUsageClass[]> = {
  'generator-fixed-host-observability-tag': ['fixed-value-assignment'],
  'orchestrator-observability-identity-boundary': [
    'environment-variable-read',
    'observability-bootstrap-forward',
  ],
  'sentry-environment-forwarder': ['sentry-config-forward'],
  'sentry-environment-and-trace-sink': ['sentry-trace-default-input', 'sentry-environment-option'],
  'sentry-trace-sampling-sink': ['trace-sampling-decision'],
  'sentry-runtime-tag-sink': ['runtime-environment-read', 'sentry-runtime-tag'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireExactKeys(
  value: unknown,
  expected: string[],
  label: string
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`${label} has unknown or missing keys`);
  }
  return value;
}

function requireTrimmedString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`${label} must be a trimmed non-empty string`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function requireSha256(value: unknown, label: string): string {
  const sha256 = requireTrimmedString(value, label);
  if (!sha256Pattern.test(sha256)) throw new Error(`${label} must be a lowercase SHA-256`);
  return sha256;
}

function sha256(contents: string | Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}

function fileSha256(path: string): string {
  return sha256(readFileSync(path));
}

type SourceFileWithParseDiagnostics = ts.SourceFile & {
  parseDiagnostics: readonly ts.Diagnostic[];
};

function requireNoParseDiagnostics(sourceFile: ts.SourceFile, label: string): void {
  const diagnostics = (sourceFile as SourceFileWithParseDiagnostics).parseDiagnostics;
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    const message =
      first === undefined
        ? 'unknown parse failure'
        : ts.flattenDiagnosticMessageText(first.messageText, '\n');
    throw new Error(`${label} has parse diagnostics: ${message}`);
  }
}

function parseStrictJson(contents: string, label: string): unknown {
  const sourceFile = ts.parseJsonText(label, contents);
  requireNoParseDiagnostics(sourceFile, label);

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set<string>();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.name)) {
          throw new Error(`${label} contains a non-JSON object property`);
        }
        const key = property.name.text;
        if (keys.has(key)) throw new Error(`${label} contains duplicate object key: ${key}`);
        keys.add(key);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  try {
    return JSON.parse(contents) as unknown;
  } catch (error) {
    throw new Error(
      `${label} is not strict JSON: ${error instanceof Error ? error.message : 'unknown parse failure'}`
    );
  }
}

function expectExactStringArray(value: unknown, expected: string[], label: string): void {
  const actual = requireUniqueStrings(value, label);
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error(`${label} does not match the reviewed semantic contract`);
  }
}

function expectExactValueClassMap(
  value: unknown,
  expected: Record<string, { value: string; valueClass: string }>,
  label: string
): void {
  const entries = requireExactKeys(value, Object.keys(expected), label);
  for (const [name, expectedEntry] of Object.entries(expected)) {
    const entry = requireExactKeys(entries[name], ['value', 'valueClass'], `${label}.${name}`);
    const actualValue = requireTrimmedString(entry['value'], `${label}.${name}.value`);
    const actualValueClass = requireTrimmedString(
      entry['valueClass'],
      `${label}.${name}.valueClass`
    );
    if (actualValue !== expectedEntry.value || actualValueClass !== expectedEntry.valueClass) {
      throw new Error(`${label}.${name} does not match the reviewed semantic contract`);
    }
  }
}

function requireRepositoryPath(value: unknown, label: string): string {
  const path = requireTrimmedString(value, label);
  if (
    isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some((segment) => segment === '' || segment === '..' || segment === '.')
  ) {
    throw new Error(`${label} must be a normalized repository-relative path`);
  }
  return path;
}

function requireUniqueStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const strings = value.map((entry, index) =>
    requireTrimmedString(entry, `${label}[${String(index)}]`)
  );
  if (new Set(strings).size !== strings.length) throw new Error(`${label} contains a duplicate`);
  return strings;
}

function parseWorkspacePackageManifest(
  repositoryRoot: string,
  packageJson: string
): WorkspacePackageManifest {
  const absolutePackageJson = resolve(repositoryRoot, packageJson);
  const stat = lstatSync(absolutePackageJson);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`workspace package manifest is not a regular file: ${packageJson}`);
  }
  const raw = parseStrictJson(readFileSync(absolutePackageJson, 'utf8'), packageJson);
  if (!isRecord(raw)) throw new Error(`workspace package manifest is invalid: ${packageJson}`);
  const name = requireTrimmedString(raw['name'], `${packageJson}.name`);
  const runtimeDependencySections = [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
  ] as const;
  const dependencySections = new Map<string, (typeof runtimeDependencySections)[number]>();
  const workspaceDependencies: string[] = [];
  const externalDependencies: string[] = [];
  for (const section of runtimeDependencySections) {
    const rawDependencies = raw[section];
    if (rawDependencies !== undefined && !isRecord(rawDependencies)) {
      throw new Error(`${packageJson}.${section} must be an object`);
    }
    for (const [dependency, version] of Object.entries(rawDependencies ?? {})) {
      requireTrimmedString(dependency, `${packageJson}.${section} name`);
      const existingSection = dependencySections.get(dependency);
      if (existingSection !== undefined) {
        throw new Error(
          `${packageJson} contains duplicate runtime dependency ${dependency} in ${existingSection} and ${section}`
        );
      }
      dependencySections.set(dependency, section);
      const normalizedVersion = requireTrimmedString(
        version,
        `${packageJson}.${section}.${dependency}`
      );
      if (!normalizedVersion.startsWith('workspace:')) {
        externalDependencies.push(dependency);
        continue;
      }
      if (normalizedVersion !== 'workspace:*') {
        throw new Error(`${packageJson} has an unsupported workspace dependency version`);
      }
      workspaceDependencies.push(dependency);
    }
  }
  workspaceDependencies.sort();
  externalDependencies.sort();
  return {
    name,
    packageJson,
    workspaceDependencies,
    absolutePackageJson,
    externalDependencies,
  };
}

function parseWorkspacePackagePatterns(contents: string): string[] {
  const lines = contents.split(/\r?\n/u);
  const packageHeaders = lines
    .map((line, index) => (line === 'packages:' ? index : -1))
    .filter((index) => index >= 0);
  if (packageHeaders.length !== 1) throw new Error('pnpm workspace packages header is invalid');
  const patterns: string[] = [];
  for (const line of lines.slice((packageHeaders[0] as number) + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/u.test(line)) break;
    const match = /^\s{2}-\s+(?:'([^']+)'|"([^"]+)"|([^\s#]+))\s*$/u.exec(line);
    const pattern = match?.[1] ?? match?.[2] ?? match?.[3];
    if (pattern === undefined) throw new Error('pnpm workspace packages entry is invalid');
    patterns.push(pattern);
  }
  return requireUniqueStrings(patterns, 'pnpm workspace packages');
}

function discoverWorkspacePackages(repositoryRoot: string): WorkspacePackageManifest[] {
  const workspaceManifestPath = resolve(repositoryRoot, 'pnpm-workspace.yaml');
  const patterns = parseWorkspacePackagePatterns(readFileSync(workspaceManifestPath, 'utf8'));
  const packageJsonPaths: string[] = [];

  for (const pattern of patterns) {
    if (isAbsolute(pattern) || pattern.includes('\\') || pattern.split('/').includes('..')) {
      throw new Error(`unsupported pnpm workspace package pattern: ${pattern}`);
    }
    if (pattern.endsWith('/*') && !pattern.slice(0, -2).includes('*')) {
      const parent = resolve(repositoryRoot, pattern.slice(0, -2));
      const parentStat = lstatSync(parent);
      if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
        throw new Error(`workspace package parent is invalid: ${pattern}`);
      }
      for (const entry of readdirSync(parent, { withFileTypes: true }).sort((left, right) =>
        left.name.localeCompare(right.name)
      )) {
        if (!entry.isDirectory()) continue;
        const candidate = resolve(parent, entry.name, 'package.json');
        try {
          if (!lstatSync(candidate).isFile()) continue;
        } catch {
          continue;
        }
        packageJsonPaths.push(relative(repositoryRoot, candidate).replaceAll('\\', '/'));
      }
      continue;
    }
    if (['*', '?', '[', ']', '{', '}'].some((character) => pattern.includes(character))) {
      throw new Error(`unsupported pnpm workspace package pattern: ${pattern}`);
    }
    const candidate = resolve(repositoryRoot, pattern, 'package.json');
    try {
      if (!lstatSync(candidate).isFile()) throw new Error('not a file');
    } catch {
      throw new Error(`missing workspace package manifest: ${pattern}/package.json`);
    }
    packageJsonPaths.push(relative(repositoryRoot, candidate).replaceAll('\\', '/'));
  }

  if (new Set(packageJsonPaths).size !== packageJsonPaths.length) {
    throw new Error('duplicate workspace package path');
  }
  const packages = packageJsonPaths.map((path) =>
    parseWorkspacePackageManifest(repositoryRoot, path)
  );
  const names = packages.map(({ name }) => name);
  if (new Set(names).size !== names.length) throw new Error('duplicate workspace package name');
  return packages;
}

function discoverRuntimeWorkspaceManifests(
  repositoryRoot: string,
  rootPackageJson: string
): {
  rootPackage: WorkspacePackageManifest;
  rootPackageJson: string;
  packages: WorkspacePackageManifest[];
} {
  const normalizedRootPackageJson = requireRepositoryPath(rootPackageJson, 'root package.json');
  const packages = discoverWorkspacePackages(repositoryRoot);
  const byName = new Map(packages.map((entry) => [entry.name, entry]));
  const rootPackage = packages.find((entry) => entry.packageJson === normalizedRootPackageJson);
  if (rootPackage === undefined) throw new Error('missing root workspace package');

  const closure = new Map<string, WorkspacePackageManifest>();
  const visit = (entry: WorkspacePackageManifest): void => {
    if (closure.has(entry.name)) return;
    closure.set(entry.name, entry);
    for (const dependency of entry.workspaceDependencies) {
      const target = byName.get(dependency);
      if (target === undefined) throw new Error(`missing workspace package: ${dependency}`);
      visit(target);
    }
  };
  visit(rootPackage);
  return {
    rootPackage,
    rootPackageJson: normalizedRootPackageJson,
    packages: [...closure.values()],
  };
}

function discoverRuntimeWorkspaceClosure(
  repositoryRoot: string,
  rootPackageJson: string
): RuntimeWorkspaceClosure {
  const {
    rootPackage,
    rootPackageJson: normalizedRootPackageJson,
    packages,
  } = discoverRuntimeWorkspaceManifests(repositoryRoot, rootPackageJson);

  const runtimePackages = packages
    .map(({ name, packageJson, workspaceDependencies }) => ({
      name,
      packageJson,
      workspaceDependencies,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    rootPackage: rootPackage.name,
    rootPackageJson: normalizedRootPackageJson,
    packages: runtimePackages,
  };
}

function discoverRuntimeBundleInputs(
  repositoryRoot: string,
  rootPackageJson: string,
  entryPoints: string[]
): string[] {
  const normalizedEntryPoints = requireUniqueStrings(entryPoints, 'runtime bundle entryPoints').map(
    (entryPoint, index) =>
      requireRepositoryPath(entryPoint, `runtime bundle entryPoints[${String(index)}]`)
  );
  if (normalizedEntryPoints.length === 0) {
    throw new Error('runtime bundle entryPoints must be a non-empty array');
  }
  for (const entryPoint of normalizedEntryPoints) {
    const entryStat = lstatSync(resolve(repositoryRoot, entryPoint));
    if (!entryStat.isFile() || entryStat.isSymbolicLink()) {
      throw new Error(`runtime bundle entryPoint is not a regular file: ${entryPoint}`);
    }
  }

  const runtimeWorkspace = discoverRuntimeWorkspaceManifests(repositoryRoot, rootPackageJson);
  const externalDependencies = [
    ...new Set(
      runtimeWorkspace.packages.flatMap(({ externalDependencies }) => externalDependencies)
    ),
  ].sort();
  let inputs: string[];
  try {
    const result = buildSync({
      entryPoints: normalizedEntryPoints.map((entryPoint) => resolve(repositoryRoot, entryPoint)),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      write: false,
      metafile: true,
      absWorkingDir: repositoryRoot,
      external: externalDependencies,
      mainFields: ['module', 'main'],
      conditions: ['import', 'node'],
      logLevel: 'silent',
    });
    if (result.metafile === undefined) throw new Error('esbuild did not return a metafile');
    inputs = Object.keys(result.metafile.inputs);
  } catch (error) {
    throw new Error(
      `runtime bundle closure resolution failed: ${error instanceof Error ? error.message : 'unknown esbuild failure'}`
    );
  }

  const normalizedInputs = inputs.map((input, index) => {
    const repositoryPath = requireRepositoryPath(
      (isAbsolute(input) ? relative(repositoryRoot, input) : input).replaceAll('\\', '/'),
      `runtime bundle input[${String(index)}]`
    );
    if (repositoryPath.startsWith('node_modules/')) {
      throw new Error(
        `runtime bundle contains a bundled non-workspace dependency: ${repositoryPath}`
      );
    }
    const absolutePath = resolve(repositoryRoot, repositoryPath);
    const inputStat = lstatSync(absolutePath);
    if (!inputStat.isFile() || inputStat.isSymbolicLink()) {
      throw new Error(`runtime bundle input is not a regular file: ${repositoryPath}`);
    }
    if (
      declarationSourceExtension.test(repositoryPath) ||
      !runtimeSourceExtension.test(repositoryPath)
    ) {
      throw new Error(`unsupported runtime bundle input: ${repositoryPath}`);
    }
    return repositoryPath;
  });
  if (new Set(normalizedInputs).size !== normalizedInputs.length) {
    throw new Error('runtime bundle closure contains a duplicate input');
  }
  normalizedInputs.sort((left, right) => left.localeCompare(right));
  for (const entryPoint of normalizedEntryPoints) {
    if (!normalizedInputs.includes(entryPoint)) {
      throw new Error(`runtime bundle closure omitted entryPoint: ${entryPoint}`);
    }
  }
  assertStaticRuntimeImports(normalizedInputs.map((input) => resolve(repositoryRoot, input)));
  return normalizedInputs;
}

function writeWorkspacePackage(
  root: string,
  relativeDirectory: string,
  name: string,
  dependencies: Record<string, string> = {},
  withSource = true
): void {
  const directory = join(root, relativeDirectory);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify({ name, dependencies }, null, 2)}\n`
  );
  if (withSource) {
    mkdirSync(join(directory, 'src'), { recursive: true });
    writeFileSync(join(directory, 'src/index.ts'), 'export {};\n');
  }
}

function isRuntimeModuleLoadingCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
  );
}

function assertStaticRuntimeImports(sourceFiles: string[]): void {
  for (const file of sourceFiles) {
    const contents = readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      contents,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(file)
    );
    requireNoParseDiagnostics(sourceFile, file);
    const visit = (node: ts.Node): void => {
      if (isRuntimeModuleLoadingCall(node)) {
        const argument = node.arguments[0];
        if (argument === undefined || !ts.isStringLiteralLike(argument)) {
          throw new Error(
            `production runtime module import must use a static string literal: ${file}`
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
}

function scriptKindForPath(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:cjs|js|mjs)$/u.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parseSourceFile(path: string): ts.SourceFile {
  const sourceFile = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(path)
  );
  requireNoParseDiagnostics(sourceFile, path);
  return sourceFile;
}

function staticPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === kind)
    ? true
    : false;
}

function assertBootstrapIdentityIsolation(
  repositoryRoot: string,
  sourceFiles: string[],
  bootstrapConfigFile: string
): void {
  const absoluteBootstrapConfig = resolve(repositoryRoot, bootstrapConfigFile);
  if (!sourceFiles.includes(absoluteBootstrapConfig)) {
    throw new Error('BootstrapEnvConfig source is outside the runtime bundle closure');
  }

  const bootstrapSource = parseSourceFile(absoluteBootstrapConfig);
  const configDeclarations = bootstrapSource.statements.filter(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === 'BootstrapEnvConfig'
  );
  if (configDeclarations.length !== 1) {
    throw new Error('BootstrapEnvConfig must have one exact interface declaration');
  }
  const configDeclaration = configDeclarations[0];
  if (configDeclaration === undefined || configDeclaration.heritageClauses !== undefined) {
    throw new Error('BootstrapEnvConfig must not inherit identity-bearing fields');
  }
  for (const member of configDeclaration.members) {
    if (ts.isIndexSignatureDeclaration(member)) {
      throw new Error('BootstrapEnvConfig must not expose an open index signature');
    }
    if ('name' in member && member.name !== undefined) {
      const name = staticPropertyName(member.name);
      if (name === undefined) {
        throw new Error('BootstrapEnvConfig must use static property names');
      }
      if (name === 'environment') {
        throw new Error('BootstrapEnvConfig must not expose legacy observability identity');
      }
    }
  }

  for (const file of sourceFiles) {
    const sourceFile = file === absoluteBootstrapConfig ? bootstrapSource : parseSourceFile(file);
    const visit = (node: ts.Node): void => {
      const readsEnvEnvironment =
        (ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'env' &&
          node.name.text === 'environment') ||
        (ts.isElementAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'env' &&
          node.argumentExpression !== undefined &&
          ts.isStringLiteralLike(node.argumentExpression) &&
          node.argumentExpression.text === 'environment');
      if (readsEnvEnvironment) {
        throw new Error(`unreviewed legacy observability identity access: ${file}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
}

function staticModuleSpecifier(node: ts.Node): string | undefined {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }
  if (isRuntimeModuleLoadingCall(node)) {
    const argument = node.arguments[0];
    return argument !== undefined && ts.isStringLiteralLike(argument) ? argument.text : undefined;
  }
  return undefined;
}

function moduleSpecifierTargetsFile(
  importer: string,
  specifier: string,
  expectedTarget: string
): boolean {
  if (!specifier.startsWith('.')) return false;
  const unresolved = resolve(dirname(importer), specifier);
  const withoutJsExtension = unresolved.replace(/\.(?:cjs|js|mjs)$/u, '');
  return [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    `${unresolved}.mts`,
    `${unresolved}.cts`,
    `${withoutJsExtension}.ts`,
    `${withoutJsExtension}.tsx`,
    `${withoutJsExtension}.mts`,
    `${withoutJsExtension}.cts`,
  ].includes(expectedTarget);
}

function assertObservabilityIdentityBoundaryUsage(
  repositoryRoot: string,
  sourceFiles: string[],
  boundary: typeof expectedObservabilityIdentityBoundary
): void {
  const boundaryPath = resolve(repositoryRoot, boundary.boundaryModule.file);
  const soleImporterPath = resolve(repositoryRoot, boundary.soleImporter.file);
  const sourceFileByPath = new Map(sourceFiles.map((file) => [file, parseSourceFile(file)]));
  const boundarySource = sourceFileByPath.get(boundaryPath);
  if (boundarySource === undefined) {
    throw new Error('observability identity boundary module is outside runtime closure');
  }

  const moduleEdges: { file: string; node: ts.Node }[] = [];
  const identifierOccurrences = new Map<string, { file: string; node: ts.Identifier }[]>();
  const trackedIdentifiers = new Set([
    boundary.boundaryModule.exportName,
    boundary.boundaryModule.brandedType,
    'readObservabilityEnvironment',
    'observabilityEnvironment',
  ]);
  for (const [file, sourceFile] of sourceFileByPath) {
    const visit = (node: ts.Node): void => {
      const specifier = staticModuleSpecifier(node);
      if (specifier !== undefined && moduleSpecifierTargetsFile(file, specifier, boundaryPath)) {
        moduleEdges.push({ file, node });
      }
      if (ts.isIdentifier(node) && trackedIdentifiers.has(node.text)) {
        const occurrences = identifierOccurrences.get(node.text) ?? [];
        occurrences.push({ file, node });
        identifierOccurrences.set(node.text, occurrences);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  if (moduleEdges.length !== 1) {
    throw new Error('observability identity boundary must have one exact importer');
  }
  const boundaryImport = moduleEdges[0];
  if (
    boundaryImport === undefined ||
    boundaryImport.file !== soleImporterPath ||
    !ts.isImportDeclaration(boundaryImport.node)
  ) {
    throw new Error('observability identity boundary import is outside the sole importer');
  }
  const importClause = boundaryImport.node.importClause;
  const namedBindings = importClause?.namedBindings;
  if (
    importClause === undefined ||
    importClause.isTypeOnly ||
    importClause.name !== undefined ||
    namedBindings === undefined ||
    !ts.isNamedImports(namedBindings) ||
    namedBindings.elements.length !== 1
  ) {
    throw new Error('observability identity boundary import must be one exact named import');
  }
  const importSpecifier = namedBindings.elements[0];
  if (
    importSpecifier === undefined ||
    importSpecifier.isTypeOnly ||
    importSpecifier.propertyName !== undefined ||
    importSpecifier.name.text !== boundary.boundaryModule.exportName
  ) {
    throw new Error('observability identity boundary export must not be aliased or re-exported');
  }

  const exportedBoundaries = boundarySource.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === boundary.boundaryModule.exportName &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
  );
  if (exportedBoundaries.length !== 1) {
    throw new Error('observability identity boundary export declaration is not exact');
  }
  const brandedTypes = boundarySource.statements.filter(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === boundary.boundaryModule.brandedType &&
      !hasModifier(statement, ts.SyntaxKind.ExportKeyword)
  );
  if (brandedTypes.length !== 1) {
    throw new Error('observability identity type must be private and branded');
  }
  const brandedType = brandedTypes[0]?.type;
  const brandMembers =
    brandedType !== undefined && ts.isIntersectionTypeNode(brandedType)
      ? brandedType.types.find(ts.isTypeLiteralNode)?.members
      : undefined;
  const brandMember = brandMembers?.[0];
  if (
    brandedType === undefined ||
    !ts.isIntersectionTypeNode(brandedType) ||
    brandedType.types.length !== 2 ||
    !brandedType.types.some((type) => type.kind === ts.SyntaxKind.StringKeyword) ||
    brandMembers?.length !== 1 ||
    brandMember === undefined ||
    !ts.isPropertySignature(brandMember) ||
    !hasModifier(brandMember, ts.SyntaxKind.ReadonlyKeyword) ||
    staticPropertyName(brandMember.name) !== '__observabilityEnvironment' ||
    brandMember.type === undefined ||
    !ts.isTypeOperatorNode(brandMember.type) ||
    brandMember.type.operator !== ts.SyntaxKind.UniqueKeyword ||
    brandMember.type.type.kind !== ts.SyntaxKind.SymbolKeyword
  ) {
    throw new Error('observability identity type must be a private branded string');
  }
  const privateReaders = boundarySource.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'readObservabilityEnvironment' &&
      !hasModifier(statement, ts.SyntaxKind.ExportKeyword)
  );
  if (privateReaders.length !== 1) {
    throw new Error('observability identity reader must be private');
  }

  const sinkImports = boundarySource.statements.filter(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === boundary.sink.module
  );
  const sinkImportClause = sinkImports[0]?.importClause;
  const sinkNamedBindings = sinkImportClause?.namedBindings;
  if (
    sinkImports.length !== 1 ||
    sinkImportClause === undefined ||
    sinkImportClause.isTypeOnly ||
    sinkImportClause.name !== undefined ||
    sinkNamedBindings === undefined ||
    !ts.isNamedImports(sinkNamedBindings) ||
    sinkNamedBindings.elements.length !== 2 ||
    !sinkNamedBindings.elements.some(
      (specifier) =>
        !specifier.isTypeOnly &&
        specifier.propertyName === undefined &&
        specifier.name.text === boundary.sink.exportName
    ) ||
    !sinkNamedBindings.elements.some(
      (specifier) =>
        specifier.isTypeOnly &&
        specifier.propertyName === undefined &&
        specifier.name.text === 'WorkerBootstrap'
    )
  ) {
    throw new Error('observability identity sink import is not exact');
  }

  const expectedIdentifierCounts: Record<string, number> = {
    [boundary.boundaryModule.exportName]: 3,
    [boundary.boundaryModule.brandedType]: 3,
    readObservabilityEnvironment: 2,
    observabilityEnvironment: 2,
  };
  for (const [name, expectedCount] of Object.entries(expectedIdentifierCounts)) {
    const occurrences = identifierOccurrences.get(name) ?? [];
    if (occurrences.length !== expectedCount) {
      throw new Error(`observability identity boundary identifier usage is not exact: ${name}`);
    }
    if (
      name !== boundary.boundaryModule.exportName &&
      occurrences.some(({ file }) => file !== boundaryPath)
    ) {
      throw new Error(`observability identity boundary identifier escaped its module: ${name}`);
    }
  }

  const importerBoundaryIdentifiers =
    identifierOccurrences
      .get(boundary.boundaryModule.exportName)
      ?.filter(({ file }) => file === soleImporterPath)
      .map(({ node }) => node) ?? [];
  if (
    importerBoundaryIdentifiers.length !== 2 ||
    !importerBoundaryIdentifiers.some((identifier) => ts.isImportSpecifier(identifier.parent)) ||
    !importerBoundaryIdentifiers.some(
      (identifier) =>
        ts.isCallExpression(identifier.parent) && identifier.parent.expression === identifier
    )
  ) {
    throw new Error('observability identity boundary must be called directly by its sole importer');
  }

  const boundaryFunction = exportedBoundaries[0];
  if (boundaryFunction?.body === undefined) {
    throw new Error('observability identity boundary function must have a body');
  }
  const initWorkerCalls: ts.CallExpression[] = [];
  const identityDeclarations: ts.VariableDeclaration[] = [];
  const visitBoundary = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === boundary.sink.exportName
    ) {
      initWorkerCalls.push(node);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'observabilityEnvironment'
    ) {
      identityDeclarations.push(node);
    }
    ts.forEachChild(node, visitBoundary);
  };
  visitBoundary(boundaryFunction.body);
  if (initWorkerCalls.length !== 1) {
    throw new Error('observability identity boundary must call one exact initWorker sink');
  }
  const identityInitializer = identityDeclarations[0]?.initializer;
  if (
    identityDeclarations.length !== 1 ||
    identityInitializer === undefined ||
    !ts.isCallExpression(identityInitializer) ||
    !ts.isIdentifier(identityInitializer.expression) ||
    identityInitializer.expression.text !== 'readObservabilityEnvironment'
  ) {
    throw new Error('branded observability identity must come directly from its private reader');
  }
  const sinkArgument = initWorkerCalls[0]?.arguments[0];
  if (sinkArgument === undefined || !ts.isObjectLiteralExpression(sinkArgument)) {
    throw new Error('observability identity sink must receive an object literal');
  }
  const environmentProperties = sinkArgument.properties.filter(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      staticPropertyName(property.name) === boundary.sink.property
  );
  if (
    environmentProperties.length !== 1 ||
    !ts.isIdentifier(environmentProperties[0]?.initializer) ||
    environmentProperties[0].initializer.text !== 'observabilityEnvironment'
  ) {
    throw new Error('branded observability identity must flow directly to initWorker.environment');
  }
}

function validateRuntimeWorkspaceClosure(value: unknown): RuntimeWorkspaceClosure {
  const closure = requireExactKeys(
    value,
    ['rootPackage', 'rootPackageJson', 'packages'],
    'runtimeWorkspaceClosure'
  );
  const rootPackage = requireTrimmedString(
    closure['rootPackage'],
    'runtimeWorkspaceClosure.rootPackage'
  );
  const rootPackageJson = requireRepositoryPath(
    closure['rootPackageJson'],
    'runtimeWorkspaceClosure.rootPackageJson'
  );
  if (!Array.isArray(closure['packages']) || closure['packages'].length === 0) {
    throw new Error('runtimeWorkspaceClosure.packages must be a non-empty array');
  }

  const packages = closure['packages'].map((value, index) => {
    const label = `runtimeWorkspaceClosure.packages[${String(index)}]`;
    const entry = requireExactKeys(value, ['name', 'packageJson', 'workspaceDependencies'], label);
    return {
      name: requireTrimmedString(entry['name'], `${label}.name`),
      packageJson: requireRepositoryPath(entry['packageJson'], `${label}.packageJson`),
      workspaceDependencies: requireUniqueStrings(
        entry['workspaceDependencies'],
        `${label}.workspaceDependencies`
      ),
    };
  });
  for (const [field, values] of [
    ['name', packages.map(({ name }) => name)],
    ['packageJson', packages.map(({ packageJson }) => packageJson)],
  ] as const) {
    if (new Set(values).size !== values.length) {
      throw new Error(`runtimeWorkspaceClosure contains a duplicate ${field}`);
    }
  }
  const sortedNames = packages
    .map(({ name }) => name)
    .sort((left, right) => left.localeCompare(right));
  if (packages.some(({ name }, index) => name !== sortedNames[index])) {
    throw new Error('runtimeWorkspaceClosure.packages must be sorted by name');
  }
  const packageNames = new Set(sortedNames);
  for (const entry of packages) {
    const sortedDependencies = [...entry.workspaceDependencies].sort();
    if (
      entry.workspaceDependencies.some(
        (dependency, index) => dependency !== sortedDependencies[index]
      )
    ) {
      throw new Error(`${entry.name} workspaceDependencies must be sorted`);
    }
    for (const dependency of entry.workspaceDependencies) {
      if (!packageNames.has(dependency)) {
        throw new Error(`${entry.name} has a missing workspace dependency`);
      }
    }
  }
  const rootEntries = packages.filter(
    ({ name, packageJson }) => name === rootPackage && packageJson === rootPackageJson
  );
  if (rootEntries.length !== 1) {
    throw new Error('runtimeWorkspaceClosure root package is missing or duplicated');
  }
  return { rootPackage, rootPackageJson, packages };
}

function runtimeBundleInputsSha256(inputs: string[]): string {
  return sha256(`${inputs.join('\n')}\n`);
}

function validateRuntimeBundleClosure(value: unknown): string[] {
  const closure = requireExactKeys(
    value,
    ['entryPoints', 'inputCount', 'inputsSha256'],
    'runtimeBundleClosure'
  );
  expectExactStringArray(
    closure['entryPoints'],
    orchestratorRuntimeEntryPoints,
    'runtimeBundleClosure.entryPoints'
  );
  const inputCount = requirePositiveInteger(
    closure['inputCount'],
    'runtimeBundleClosure.inputCount'
  );
  const inputsSha256 = requireSha256(closure['inputsSha256'], 'runtimeBundleClosure.inputsSha256');
  const inputs = discoverRuntimeBundleInputs(
    repoRoot,
    'workers/orchestrator/package.json',
    orchestratorRuntimeEntryPoints
  );
  if (inputCount !== inputs.length || inputsSha256 !== runtimeBundleInputsSha256(inputs)) {
    throw new Error('identity audit runtimeBundleClosure is stale');
  }
  return inputs;
}

function validateReviewedBoundaryFile(
  value: unknown,
  expectedFile: string,
  extraKeys: string[],
  label: string,
  runtimeFiles: Set<string>
): Record<string, unknown> & ReviewedBoundaryFile {
  const entry = requireExactKeys(value, ['file', 'reviewedSha256', ...extraKeys], label);
  const file = requireRepositoryPath(entry['file'], `${label}.file`);
  if (file !== expectedFile) {
    throw new Error(`${label}.file does not match the reviewed semantic contract`);
  }
  if (!runtimeFiles.has(file)) throw new Error(`${label}.file is outside runtime closure`);
  const reviewedSha256 = requireSha256(entry['reviewedSha256'], `${label}.reviewedSha256`);
  if (reviewedSha256 !== fileSha256(resolve(repoRoot, file))) {
    throw new Error(`${label}.reviewedSha256 is stale`);
  }
  return { ...entry, file, reviewedSha256 };
}

function validateObservabilityIdentityBoundary(
  value: unknown,
  runtimeBundleInputs: string[]
): ObservabilityIdentityBoundary {
  const label = 'observabilityIdentityBoundary';
  const boundary = requireExactKeys(
    value,
    ['bootstrapConfig', 'boundaryModule', 'soleImporter', 'serviceWiring', 'sink'],
    label
  );
  const runtimeFiles = new Set(runtimeBundleInputs);

  const bootstrapConfig = validateReviewedBoundaryFile(
    boundary['bootstrapConfig'],
    expectedObservabilityIdentityBoundary.bootstrapConfig.file,
    ['forbiddenField'],
    `${label}.bootstrapConfig`,
    runtimeFiles
  );
  if (
    bootstrapConfig['forbiddenField'] !==
    expectedObservabilityIdentityBoundary.bootstrapConfig.forbiddenField
  ) {
    throw new Error(`${label}.bootstrapConfig.forbiddenField does not match the reviewed contract`);
  }

  const boundaryModule = validateReviewedBoundaryFile(
    boundary['boundaryModule'],
    expectedObservabilityIdentityBoundary.boundaryModule.file,
    ['exportName', 'brandedType'],
    `${label}.boundaryModule`,
    runtimeFiles
  );
  if (
    boundaryModule['exportName'] !==
      expectedObservabilityIdentityBoundary.boundaryModule.exportName ||
    boundaryModule['brandedType'] !==
      expectedObservabilityIdentityBoundary.boundaryModule.brandedType
  ) {
    throw new Error(`${label}.boundaryModule does not match the reviewed semantic contract`);
  }

  const soleImporter = validateReviewedBoundaryFile(
    boundary['soleImporter'],
    expectedObservabilityIdentityBoundary.soleImporter.file,
    [],
    `${label}.soleImporter`,
    runtimeFiles
  );
  const serviceWiring = validateReviewedBoundaryFile(
    boundary['serviceWiring'],
    expectedObservabilityIdentityBoundary.serviceWiring.file,
    [],
    `${label}.serviceWiring`,
    runtimeFiles
  );

  const sink = requireExactKeys(
    boundary['sink'],
    ['module', 'exportName', 'property'],
    `${label}.sink`
  );
  if (
    sink['module'] !== expectedObservabilityIdentityBoundary.sink.module ||
    sink['exportName'] !== expectedObservabilityIdentityBoundary.sink.exportName ||
    sink['property'] !== expectedObservabilityIdentityBoundary.sink.property
  ) {
    throw new Error(`${label}.sink does not match the reviewed semantic contract`);
  }

  const absoluteRuntimeFiles = runtimeBundleInputs.map((file) => resolve(repoRoot, file));
  assertBootstrapIdentityIsolation(
    repoRoot,
    absoluteRuntimeFiles,
    expectedObservabilityIdentityBoundary.bootstrapConfig.file
  );
  assertObservabilityIdentityBoundaryUsage(
    repoRoot,
    absoluteRuntimeFiles,
    expectedObservabilityIdentityBoundary
  );

  return {
    bootstrapConfig: {
      file: bootstrapConfig.file,
      forbiddenField: 'environment',
      reviewedSha256: bootstrapConfig.reviewedSha256,
    },
    boundaryModule: {
      file: boundaryModule.file,
      exportName: 'initOrchestratorObservability',
      brandedType: 'ObservabilityEnvironment',
      reviewedSha256: boundaryModule.reviewedSha256,
    },
    soleImporter: {
      file: soleImporter.file,
      reviewedSha256: soleImporter.reviewedSha256,
    },
    serviceWiring: {
      file: serviceWiring.file,
      reviewedSha256: serviceWiring.reviewedSha256,
    },
    sink: {
      module: '@intexuraos/infra-sentry',
      exportName: 'initWorker',
      property: 'environment',
    },
  };
}

function requireIdentityTagName(value: unknown, label: string): IdentityTagName {
  const name = requireTrimmedString(value, label);
  if (name !== 'INTEXURAOS_ENVIRONMENT' && name !== 'INTEXURAOS_RUNTIME') {
    throw new Error(`${label} is unsupported`);
  }
  return name;
}

function requireIdentitySinkClassification(
  value: unknown,
  label: string
): IdentitySinkClassification {
  const classification = requireTrimmedString(value, label) as IdentitySinkClassification;
  if (!allowedSinkClassifications.has(classification)) {
    throw new Error(`${label} is not an allowed non-routing sink classification`);
  }
  return classification;
}

function requireIdentityUsageClass(
  value: unknown,
  sinkClassification: IdentitySinkClassification,
  label: string
): IdentityUsageClass {
  const usageClass = requireTrimmedString(value, label) as IdentityUsageClass;
  if (!allowedUsageClassesBySink[sinkClassification].includes(usageClass)) {
    throw new Error(`${label} is not allowed for ${sinkClassification}`);
  }
  return usageClass;
}

function validateUsageBindings(
  file: string,
  value: unknown,
  sinkClassification: IdentitySinkClassification,
  label: string
): IdentityUsageBinding[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }

  const absolutePath = resolve(repoRoot, file);
  const contents = readFileSync(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    absolutePath,
    contents,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(absolutePath)
  );
  requireNoParseDiagnostics(sourceFile, file);
  const sourceNodes: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    sourceNodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const bindings = value.map((rawBinding, index) => {
    const bindingLabel = `${label}[${String(index)}]`;
    const binding = requireExactKeys(
      rawBinding,
      ['usageClass', 'line', 'column', 'nodeKind', 'spanSha256'],
      bindingLabel
    );
    const usageClass = requireIdentityUsageClass(
      binding['usageClass'],
      sinkClassification,
      `${bindingLabel}.usageClass`
    );
    const line = requirePositiveInteger(binding['line'], `${bindingLabel}.line`);
    const column = requirePositiveInteger(binding['column'], `${bindingLabel}.column`);
    const nodeKind = requireTrimmedString(binding['nodeKind'], `${bindingLabel}.nodeKind`);
    const spanSha256 = requireSha256(binding['spanSha256'], `${bindingLabel}.spanSha256`);
    const matchingNodes = sourceNodes.filter((node) => {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      return (
        position.line + 1 === line &&
        position.character + 1 === column &&
        ts.SyntaxKind[node.kind] === nodeKind
      );
    });
    if (matchingNodes.length !== 1) {
      throw new Error(`${bindingLabel} does not resolve to one exact AST usage`);
    }
    const matchingNode = matchingNodes[0];
    if (matchingNode === undefined || sha256(matchingNode.getText(sourceFile)) !== spanSha256) {
      throw new Error(`${bindingLabel}.spanSha256 is stale`);
    }
    return { usageClass, line, column, nodeKind, spanSha256 };
  });
  const bindingKeys = bindings.map(
    ({ usageClass, line, column, nodeKind }) =>
      `${usageClass}:${String(line)}:${String(column)}:${nodeKind}`
  );
  if (new Set(bindingKeys).size !== bindingKeys.length) {
    throw new Error(`${label} contains a duplicate`);
  }
  return bindings;
}

function validateOccurrenceConsumerCoverage(
  literalReferences: IdentityLiteralReference[],
  consumers: Pick<ReviewedIdentityConsumer, 'envName' | 'file'>[]
): void {
  const consumerPairs = new Set(consumers.map(({ envName, file }) => `${envName}:${file}`));
  const occurrencePairs = new Set(
    literalReferences.map(({ envName, file }) => `${envName}:${file}`)
  );
  for (const occurrencePair of occurrencePairs) {
    if (!consumerPairs.has(occurrencePair)) {
      throw new Error(`missing reviewed consumer for ${occurrencePair}`);
    }
  }
}

function validateIdentityAudit(value: unknown): IdentityAudit {
  const audit = requireExactKeys(
    value,
    [
      'schemaVersion',
      'scope',
      'callbackOwner',
      'fixedTags',
      'runtimeWorkspaceClosure',
      'runtimeBundleClosure',
      'observabilityIdentityBoundary',
      'literalReferences',
      'consumers',
      'routingAuthorities',
      'credentialAuthorities',
      'pendingLiveGates',
    ],
    'identity audit'
  );
  if (audit['schemaVersion'] !== 6) throw new Error('identity audit schemaVersion must be 6');
  const scope = requireTrimmedString(audit['scope'], 'identity audit scope');
  if (scope !== expectedScope) {
    throw new Error('identity audit scope does not match the reviewed semantic contract');
  }
  expectExactValueClassMap(
    audit['callbackOwner'],
    expectedCallbackOwner,
    'identity audit callbackOwner'
  );
  expectExactValueClassMap(audit['fixedTags'], expectedFixedTags, 'identity audit fixedTags');
  const closure = validateRuntimeWorkspaceClosure(audit['runtimeWorkspaceClosure']);
  const discoveredClosure = discoverRuntimeWorkspaceClosure(
    repoRoot,
    'workers/orchestrator/package.json'
  );
  if (JSON.stringify(closure) !== JSON.stringify(discoveredClosure)) {
    throw new Error('identity audit runtimeWorkspaceClosure is stale');
  }
  const runtimeBundleInputs = validateRuntimeBundleClosure(audit['runtimeBundleClosure']);
  validateObservabilityIdentityBoundary(
    audit['observabilityIdentityBoundary'],
    runtimeBundleInputs
  );
  const allowedRuntimeFiles = new Set([
    'scripts/generate-orchestrator-env.mjs',
    ...runtimeBundleInputs,
  ]);
  const isRuntimeFile = (file: string): boolean => allowedRuntimeFiles.has(file);

  if (!Array.isArray(audit['literalReferences'])) {
    throw new Error('identity audit literalReferences must be an array');
  }
  const literalReferences = audit['literalReferences'].map((value, index) => {
    const label = `identity audit literalReferences[${String(index)}]`;
    const entry = requireExactKeys(
      value,
      ['envName', 'file', 'line', 'column', 'nodeKind', 'reviewedSha256'],
      label
    );
    const envName = requireIdentityTagName(entry['envName'], `${label}.envName`);
    const file = requireRepositoryPath(entry['file'], `${label}.file`);
    if (!isRuntimeFile(file)) throw new Error(`${label}.file is outside runtime closure`);
    const line = requirePositiveInteger(entry['line'], `${label}.line`);
    const column = requirePositiveInteger(entry['column'], `${label}.column`);
    const nodeKind = requireTrimmedString(entry['nodeKind'], `${label}.nodeKind`);
    if (nodeKind !== 'Identifier' && nodeKind !== 'StringLiteral') {
      throw new Error(`${label}.nodeKind is unsupported`);
    }
    const reviewedSha256 = requireSha256(entry['reviewedSha256'], `${label}.reviewedSha256`);
    if (reviewedSha256 !== fileSha256(resolve(repoRoot, file))) {
      throw new Error(`${label}.reviewedSha256 is stale`);
    }
    return { envName, file, line, column, nodeKind, reviewedSha256 };
  });
  const referenceKeys = literalReferences.map(
    ({ envName, file, line, column, nodeKind }) =>
      `${file}:${String(line)}:${String(column)}:${nodeKind}:${envName}`
  );
  if (new Set(referenceKeys).size !== referenceKeys.length) {
    throw new Error('identity audit literalReferences contains a duplicate');
  }
  const discoveredReferences = discoverIdentityTagReferences();
  if (JSON.stringify(literalReferences) !== JSON.stringify(discoveredReferences)) {
    throw new Error('identity audit literalReferences do not provide exact 1:1 coverage');
  }

  if (!Array.isArray(audit['consumers'])) {
    throw new Error('identity audit consumers must be an array');
  }
  const consumers = audit['consumers'].map((value, index) => {
    const label = `identity audit consumers[${String(index)}]`;
    const entry = requireExactKeys(
      value,
      [
        'envName',
        'file',
        'purpose',
        'routingAuthority',
        'sinkClassification',
        'reviewedSha256',
        'usageBindings',
      ],
      label
    );
    const envName = requireIdentityTagName(entry['envName'], `${label}.envName`);
    const file = requireRepositoryPath(entry['file'], `${label}.file`);
    if (!isRuntimeFile(file)) throw new Error(`${label}.file is outside runtime closure`);
    const purpose = requireTrimmedString(entry['purpose'], `${label}.purpose`);
    if (entry['routingAuthority'] !== false) {
      throw new Error(`${label}.routingAuthority must be false`);
    }
    const sinkClassification = requireIdentitySinkClassification(
      entry['sinkClassification'],
      `${label}.sinkClassification`
    );
    const reviewedSha256 = requireSha256(entry['reviewedSha256'], `${label}.reviewedSha256`);
    if (reviewedSha256 !== fileSha256(resolve(repoRoot, file))) {
      throw new Error(`${label}.reviewedSha256 is stale`);
    }
    const usageBindings = validateUsageBindings(
      file,
      entry['usageBindings'],
      sinkClassification,
      `${label}.usageBindings`
    );
    return {
      envName,
      file,
      purpose,
      routingAuthority: false as const,
      sinkClassification,
      reviewedSha256,
      usageBindings,
    };
  });
  const consumerKeys = consumers.map(({ envName, file }) => `${envName}:${file}`);
  if (new Set(consumerKeys).size !== consumerKeys.length) {
    throw new Error('identity audit consumers contains a duplicate');
  }
  const consumerContract = consumers.map(({ reviewedSha256: _reviewedSha256, ...entry }) => entry);
  if (JSON.stringify(consumerContract) !== JSON.stringify(expectedConsumers)) {
    throw new Error('identity audit consumers do not match the exact reviewed sink contract');
  }
  validateOccurrenceConsumerCoverage(literalReferences, consumers);

  expectExactStringArray(
    audit['routingAuthorities'],
    expectedRoutingAuthorities,
    'identity audit routingAuthorities'
  );
  expectExactStringArray(
    audit['credentialAuthorities'],
    expectedCredentialAuthorities,
    'identity audit credentialAuthorities'
  );
  expectExactStringArray(
    audit['pendingLiveGates'],
    expectedPendingLiveGates,
    'identity audit pendingLiveGates'
  );

  return value as IdentityAudit;
}

function discoverIdentityTagReferencesInFiles(
  repositoryRoot: string,
  sourceFiles: string[]
): IdentityLiteralReference[] {
  const references: IdentityLiteralReference[] = [];

  for (const file of sourceFiles) {
    const contents = readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      contents,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(file)
    );
    requireNoParseDiagnostics(sourceFile, relative(repositoryRoot, file));
    const reviewedSha256 = sha256(contents);
    const repositoryPath = requireRepositoryPath(
      relative(repositoryRoot, file).replaceAll('\\', '/'),
      'identity reference file'
    );
    const visit = (node: ts.Node): void => {
      if (
        (ts.isStringLiteralLike(node) || ts.isIdentifier(node)) &&
        (node.text === 'INTEXURAOS_ENVIRONMENT' || node.text === 'INTEXURAOS_RUNTIME')
      ) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        references.push({
          envName: node.text,
          file: repositoryPath,
          line: position.line + 1,
          column: position.character + 1,
          nodeKind: ts.isIdentifier(node) ? 'Identifier' : 'StringLiteral',
          reviewedSha256,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return references.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.nodeKind.localeCompare(right.nodeKind) ||
      left.envName.localeCompare(right.envName)
  );
}

function discoverIdentityTagReferences(): IdentityLiteralReference[] {
  const runtimeBundleInputs = discoverRuntimeBundleInputs(
    repoRoot,
    'workers/orchestrator/package.json',
    orchestratorRuntimeEntryPoints
  );
  const sourceFiles = [
    resolve(repoRoot, 'scripts/generate-orchestrator-env.mjs'),
    ...runtimeBundleInputs.map((input) => resolve(repoRoot, input)),
  ];
  return discoverIdentityTagReferencesInFiles(repoRoot, sourceFiles);
}

function readIdentityAudit(): IdentityAudit {
  return validateIdentityAudit(
    parseStrictJson(readFileSync(identityAuditPath, 'utf8'), identityAuditPath)
  );
}

describe('Home Dev orchestrator production ownership', () => {
  it('requires occurrence-level identity references and review-bound consumer sinks', () => {
    const audit = readIdentityAudit();

    expect(audit.schemaVersion).toBe(6);
    expect(audit.literalReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          envName: 'INTEXURAOS_ENVIRONMENT',
          file: 'scripts/generate-orchestrator-env.mjs',
          line: 15,
          column: 3,
          nodeKind: 'StringLiteral',
          reviewedSha256: fileSha256(generatorPath),
        }),
      ])
    );
    expect(
      audit.literalReferences.filter(({ file }) => file === 'scripts/generate-orchestrator-env.mjs')
    ).toHaveLength(5);
    expect(audit.consumers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reviewedSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
          sinkClassification: expect.any(String),
          usageBindings: expect.arrayContaining([
            expect.objectContaining({
              usageClass: expect.any(String),
              line: expect.any(Number),
              column: expect.any(Number),
              nodeKind: expect.any(String),
              spanSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
            }),
          ]),
        }),
      ])
    );
  });

  it('derives the complete transitive runtime workspace dependency closure', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'orchestrator-workspace-closure-'));
    writeFileSync(
      join(tempRoot, 'pnpm-workspace.yaml'),
      "packages:\n  - 'workers/*'\n  - 'packages/*'\n"
    );
    writeWorkspacePackage(tempRoot, 'workers/orchestrator', '@fixture/orchestrator', {
      '@fixture/direct': 'workspace:*',
    });
    writeWorkspacePackage(tempRoot, 'packages/direct', '@fixture/direct', {
      '@fixture/transitive': 'workspace:*',
    });
    writeFileSync(
      join(tempRoot, 'packages/direct/package.json'),
      `${JSON.stringify(
        {
          name: '@fixture/direct',
          dependencies: { '@fixture/transitive': 'workspace:*' },
          optionalDependencies: { '@fixture/optional-transitive': 'workspace:*' },
          peerDependencies: { '@fixture/peer-transitive': 'workspace:*' },
        },
        null,
        2
      )}\n`
    );
    writeWorkspacePackage(tempRoot, 'packages/transitive', '@fixture/transitive');
    writeWorkspacePackage(tempRoot, 'packages/optional-transitive', '@fixture/optional-transitive');
    writeWorkspacePackage(tempRoot, 'packages/peer-transitive', '@fixture/peer-transitive');

    const closure = discoverRuntimeWorkspaceClosure(tempRoot, 'workers/orchestrator/package.json');

    expect(closure.packages.map(({ name }) => name)).toEqual([
      '@fixture/direct',
      '@fixture/optional-transitive',
      '@fixture/orchestrator',
      '@fixture/peer-transitive',
      '@fixture/transitive',
    ]);
    expect(
      closure.packages.find(({ name }) => name === '@fixture/direct')?.workspaceDependencies
    ).toEqual(['@fixture/optional-transitive', '@fixture/peer-transitive', '@fixture/transitive']);
  });

  it('derives actual bundle inputs through package exports and relative source-root escapes', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'orchestrator-bundle-input-closure-'));
    writeFileSync(
      join(tempRoot, 'pnpm-workspace.yaml'),
      "packages:\n  - 'workers/*'\n  - 'packages/*'\n"
    );
    writeWorkspacePackage(tempRoot, 'workers/orchestrator', '@fixture/orchestrator', {
      '@fixture/exported': 'workspace:*',
      '@fixture/outside-src': 'workspace:*',
    });
    writeFileSync(
      join(tempRoot, 'workers/orchestrator/src/index.ts'),
      "import '@fixture/exported';\nimport '@fixture/outside-src';\nimport '../runtime.js';\n"
    );
    writeFileSync(
      join(tempRoot, 'workers/orchestrator/runtime.ts'),
      "export const escaped = 'INTEXURAOS_RUNTIME';\n"
    );
    writeWorkspacePackage(tempRoot, 'packages/exported', '@fixture/exported');
    mkdirSync(join(tempRoot, 'packages/exported/src/__tests__'), { recursive: true });
    writeFileSync(
      join(tempRoot, 'packages/exported/package.json'),
      `${JSON.stringify(
        {
          name: '@fixture/exported',
          type: 'module',
          exports: { '.': './src/__tests__/identity-router.ts' },
        },
        null,
        2
      )}\n`
    );
    writeFileSync(
      join(tempRoot, 'packages/exported/src/__tests__/identity-router.ts'),
      "export const routed = 'INTEXURAOS_ENVIRONMENT';\n"
    );
    mkdirSync(join(tempRoot, 'packages/outside-src'), { recursive: true });
    writeFileSync(
      join(tempRoot, 'packages/outside-src/package.json'),
      `${JSON.stringify(
        {
          name: '@fixture/outside-src',
          type: 'module',
          exports: { '.': './runtime.ts' },
        },
        null,
        2
      )}\n`
    );
    writeFileSync(
      join(tempRoot, 'packages/outside-src/runtime.ts'),
      'export const outsideSourceRoot = true;\n'
    );
    mkdirSync(join(tempRoot, 'node_modules/@fixture'), { recursive: true });
    symlinkSync(
      resolve(tempRoot, 'packages/exported'),
      join(tempRoot, 'node_modules/@fixture/exported'),
      'dir'
    );
    symlinkSync(
      resolve(tempRoot, 'packages/outside-src'),
      join(tempRoot, 'node_modules/@fixture/outside-src'),
      'dir'
    );

    expect(() =>
      discoverRuntimeWorkspaceClosure(tempRoot, 'workers/orchestrator/package.json')
    ).not.toThrow();

    const inputs = discoverRuntimeBundleInputs(tempRoot, 'workers/orchestrator/package.json', [
      'workers/orchestrator/src/index.ts',
    ]);

    expect(inputs).toContain('packages/exported/src/__tests__/identity-router.ts');
    expect(inputs).toContain('packages/outside-src/runtime.ts');
    expect(inputs).toContain('workers/orchestrator/runtime.ts');
    const references = discoverIdentityTagReferencesInFiles(
      tempRoot,
      inputs.map((file) => resolve(tempRoot, file))
    );
    expect(references.map(({ envName, file }) => ({ envName, file }))).toEqual([
      {
        envName: 'INTEXURAOS_ENVIRONMENT',
        file: 'packages/exported/src/__tests__/identity-router.ts',
      },
      { envName: 'INTEXURAOS_RUNTIME', file: 'workers/orchestrator/runtime.ts' },
    ]);

    writeFileSync(
      join(tempRoot, 'workers/orchestrator/src/index.ts'),
      "import './missing-runtime.js';\n"
    );
    expect(() =>
      discoverRuntimeBundleInputs(tempRoot, 'workers/orchestrator/package.json', [
        'workers/orchestrator/src/index.ts',
      ])
    ).toThrow('runtime bundle closure resolution failed');

    writeFileSync(
      join(tempRoot, 'workers/orchestrator/src/index.ts'),
      "const target = '../runtime.js';\nvoid import(target);\n"
    );
    expect(() =>
      discoverRuntimeBundleInputs(tempRoot, 'workers/orchestrator/package.json', [
        'workers/orchestrator/src/index.ts',
      ])
    ).toThrow('runtime module import must use a static string literal');
  });

  it('fails closed on missing or duplicate workspace packages', () => {
    const missingPackageRoot = mkdtempSync(join(tmpdir(), 'orchestrator-workspace-missing-'));
    writeFileSync(join(missingPackageRoot, 'pnpm-workspace.yaml'), "packages:\n  - 'workers/*'\n");
    writeWorkspacePackage(missingPackageRoot, 'workers/orchestrator', '@fixture/orchestrator', {
      '@fixture/missing': 'workspace:*',
    });
    expect(() =>
      discoverRuntimeWorkspaceClosure(missingPackageRoot, 'workers/orchestrator/package.json')
    ).toThrow('missing workspace package');

    const duplicateRoot = mkdtempSync(join(tmpdir(), 'orchestrator-workspace-duplicate-'));
    writeFileSync(
      join(duplicateRoot, 'pnpm-workspace.yaml'),
      "packages:\n  - 'workers/*'\n  - 'packages/*'\n"
    );
    writeWorkspacePackage(duplicateRoot, 'workers/orchestrator', '@fixture/duplicate');
    writeWorkspacePackage(duplicateRoot, 'packages/duplicate', '@fixture/duplicate');
    expect(() =>
      discoverRuntimeWorkspaceClosure(duplicateRoot, 'workers/orchestrator/package.json')
    ).toThrow('duplicate workspace package');

    const duplicateDependencyRoot = mkdtempSync(
      join(tmpdir(), 'orchestrator-workspace-duplicate-dependency-')
    );
    writeFileSync(
      join(duplicateDependencyRoot, 'pnpm-workspace.yaml'),
      "packages:\n  - 'workers/*'\n  - 'packages/*'\n"
    );
    writeWorkspacePackage(duplicateDependencyRoot, 'workers/orchestrator', '@fixture/orchestrator');
    writeFileSync(
      join(duplicateDependencyRoot, 'workers/orchestrator/package.json'),
      `${JSON.stringify(
        {
          name: '@fixture/orchestrator',
          dependencies: { '@fixture/shared': 'workspace:*' },
          peerDependencies: { '@fixture/shared': 'workspace:*' },
        },
        null,
        2
      )}\n`
    );
    writeWorkspacePackage(duplicateDependencyRoot, 'packages/shared', '@fixture/shared');
    expect(() =>
      discoverRuntimeWorkspaceClosure(duplicateDependencyRoot, 'workers/orchestrator/package.json')
    ).toThrow('duplicate runtime dependency');

    const duplicateJsonKeyRoot = mkdtempSync(
      join(tmpdir(), 'orchestrator-workspace-duplicate-json-key-')
    );
    writeFileSync(
      join(duplicateJsonKeyRoot, 'pnpm-workspace.yaml'),
      "packages:\n  - 'workers/*'\n"
    );
    writeWorkspacePackage(duplicateJsonKeyRoot, 'workers/orchestrator', '@fixture/orchestrator');
    writeFileSync(
      join(duplicateJsonKeyRoot, 'workers/orchestrator/package.json'),
      '{"name":"@fixture/orchestrator","dependencies":{},"dependencies":{}}\n'
    );
    expect(() =>
      discoverRuntimeWorkspaceClosure(duplicateJsonKeyRoot, 'workers/orchestrator/package.json')
    ).toThrow('duplicate object key: dependencies');
  });

  it('records every AST occurrence and fails closed on parse diagnostics', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'orchestrator-identity-occurrences-'));
    const repeatedPath = join(tempRoot, 'repeated.ts');
    writeFileSync(
      repeatedPath,
      "const first = 'INTEXURAOS_ENVIRONMENT';\nconst second = 'INTEXURAOS_ENVIRONMENT';\n"
    );

    const occurrences = discoverIdentityTagReferencesInFiles(tempRoot, [repeatedPath]);
    expect(occurrences).toHaveLength(2);
    expect(occurrences.map(({ line, column, nodeKind }) => ({ line, column, nodeKind }))).toEqual([
      { line: 1, column: 15, nodeKind: 'StringLiteral' },
      { line: 2, column: 16, nodeKind: 'StringLiteral' },
    ]);
    expect(
      occurrences.every(({ reviewedSha256 }) => reviewedSha256 === fileSha256(repeatedPath))
    ).toBe(true);

    const invalidPath = join(tempRoot, 'invalid.ts');
    writeFileSync(invalidPath, "const tag = 'INTEXURAOS_RUNTIME';\n}\n");
    expect(() => discoverIdentityTagReferencesInFiles(tempRoot, [invalidPath])).toThrow(
      'parse diagnostics'
    );
  });

  it('rejects a new literal-bearing runtime file without a reviewed consumer', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'orchestrator-identity-unclassified-router-'));
    const routerPath = join(tempRoot, 'router.ts');
    writeFileSync(routerPath, "export const owner = 'INTEXURAOS_ENVIRONMENT';\n");
    const references = discoverIdentityTagReferencesInFiles(tempRoot, [routerPath]);

    expect(() => validateOccurrenceConsumerCoverage(references, [])).toThrow(
      'missing reviewed consumer for INTEXURAOS_ENVIRONMENT:router.ts'
    );
  });

  it('rejects routing through BootstrapEnvConfig identity without an env-name literal', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'orchestrator-bootstrap-identity-bypass-'));
    const envConfigPath = join(tempRoot, 'env-config.ts');
    const serviceWiringPath = join(tempRoot, 'service-wiring.ts');
    writeFileSync(
      envConfigPath,
      [
        'export interface BootstrapEnvConfig {',
        '  codeAgentUrl: string;',
        '  environment: string;',
        '}',
        '',
      ].join('\n')
    );
    writeFileSync(
      serviceWiringPath,
      [
        "import type { BootstrapEnvConfig } from './env-config.js';",
        'export function selectRoute(env: BootstrapEnvConfig): string {',
        "  return env.environment === 'dev' ? 'https://dev.invalid' : env.codeAgentUrl;",
        '}',
        '',
      ].join('\n')
    );

    expect(
      discoverIdentityTagReferencesInFiles(tempRoot, [envConfigPath, serviceWiringPath])
    ).toEqual([]);
    expect(() =>
      assertBootstrapIdentityIsolation(
        tempRoot,
        [envConfigPath, serviceWiringPath],
        'env-config.ts'
      )
    ).toThrow('BootstrapEnvConfig must not expose legacy observability identity');

    writeFileSync(
      envConfigPath,
      ['export interface BootstrapEnvConfig {', '  codeAgentUrl: string;', '}', ''].join('\n')
    );
    expect(() =>
      assertBootstrapIdentityIsolation(
        tempRoot,
        [envConfigPath, serviceWiringPath],
        'env-config.ts'
      )
    ).toThrow('unreviewed legacy observability identity access');
  });

  it('fails closed when the branded observability boundary gains another importer', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'orchestrator-observability-boundary-import-'));
    const boundaryPath = resolve(
      tempRoot,
      expectedObservabilityIdentityBoundary.boundaryModule.file
    );
    const importerPath = resolve(tempRoot, expectedObservabilityIdentityBoundary.soleImporter.file);
    mkdirSync(dirname(boundaryPath), { recursive: true });
    writeFileSync(
      boundaryPath,
      [
        "import { initWorker, type WorkerBootstrap } from '@intexuraos/infra-sentry';",
        'type ObservabilityEnvironment = string & {',
        '  readonly __observabilityEnvironment: unique symbol;',
        '};',
        'function readObservabilityEnvironment(): ObservabilityEnvironment {',
        "  return 'dev' as ObservabilityEnvironment;",
        '}',
        'export function initOrchestratorObservability(): WorkerBootstrap {',
        '  const observabilityEnvironment = readObservabilityEnvironment();',
        '  return initWorker({',
        "    serviceName: 'orchestrator',",
        '    environment: observabilityEnvironment,',
        '  });',
        '}',
        '',
      ].join('\n')
    );
    mkdirSync(dirname(importerPath), { recursive: true });
    writeFileSync(
      importerPath,
      [
        "import { initOrchestratorObservability } from './bootstrap/observability-identity.js';",
        'export function start(): unknown {',
        '  return initOrchestratorObservability();',
        '}',
        '',
      ].join('\n')
    );

    expect(() =>
      assertObservabilityIdentityBoundaryUsage(
        tempRoot,
        [boundaryPath, importerPath],
        expectedObservabilityIdentityBoundary
      )
    ).not.toThrow();

    const rogueImporterPath = join(tempRoot, 'workers/orchestrator/src/rogue-router.ts');
    writeFileSync(
      rogueImporterPath,
      "import { initOrchestratorObservability } from './bootstrap/observability-identity.js';\n"
    );
    expect(() =>
      assertObservabilityIdentityBoundaryUsage(
        tempRoot,
        [boundaryPath, importerPath, rogueImporterPath],
        expectedObservabilityIdentityBoundary
      )
    ).toThrow('observability identity boundary must have one exact importer');
  });

  it('pins production callbacks and legacy host tags regardless of inherited values', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'orchestrator-production-owner-'));
    const outputPath = join(tempRoot, 'env');

    execFileSync(
      process.execPath,
      [generatorPath, '--output', outputPath, '--user-home', tempRoot],
      {
        cwd: repoRoot,
        env: generatorEnvironment(),
        stdio: 'pipe',
      }
    );

    const generated = parse(readFileSync(outputPath, 'utf8'));
    expect(generated['INTEXURAOS_CODE_AGENT_URL']).toBe('https://intexuraos.cloud/api/code');
    expect(generated['INTEXURAOS_USAGE_WEBHOOK_URL']).toBe(
      'https://intexuraos.cloud/api/code/internal/webhooks/usage-events'
    );
    expect(generated['INTEXURAOS_ENVIRONMENT']).toBe('dev');
    expect(generated['INTEXURAOS_RUNTIME']).toBe('dev');
    expect(generated['INTEXURAOS_CODE_AGENT_URL']).not.toContain('localhost');
    expect(generated['INTEXURAOS_USAGE_WEBHOOK_URL']).not.toContain('dev.intexuraos.cloud');
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
  });

  it('tracks every Home Dev identity-tag consumer as non-routing', () => {
    const audit = readIdentityAudit();
    const runtimeWorkspaceClosure = discoverRuntimeWorkspaceClosure(
      repoRoot,
      'workers/orchestrator/package.json'
    );

    expect(() => validateIdentityAudit(audit)).not.toThrow();
    expect(audit.schemaVersion).toBe(6);
    expect(audit.runtimeBundleClosure).toEqual({
      entryPoints: orchestratorRuntimeEntryPoints,
      inputCount: 166,
      inputsSha256: '631d9364ffa82ec41622aa273487e85a832e80d1d6d66321b5d4908b92897d41',
    });
    expect(audit.observabilityIdentityBoundary.bootstrapConfig.forbiddenField).toBe('environment');
    expect(audit.observabilityIdentityBoundary.boundaryModule).toEqual(
      expect.objectContaining({
        file: 'workers/orchestrator/src/bootstrap/observability-identity.ts',
        exportName: 'initOrchestratorObservability',
        brandedType: 'ObservabilityEnvironment',
      })
    );
    expect(audit.observabilityIdentityBoundary.sink).toEqual({
      module: '@intexuraos/infra-sentry',
      exportName: 'initWorker',
      property: 'environment',
    });
    expect(audit.runtimeWorkspaceClosure).toEqual(runtimeWorkspaceClosure);
    expect(audit.runtimeWorkspaceClosure.packages.map(({ name }) => name)).toContain(
      '@intexuraos/llm-pricing'
    );
    expect(audit.callbackOwner).toEqual(expectedCallbackOwner);
    expect(audit.fixedTags).toEqual(expectedFixedTags);
    expect(audit.routingAuthorities).toEqual(expectedRoutingAuthorities);
    expect(audit.credentialAuthorities).toEqual(expectedCredentialAuthorities);
    expect(audit.consumers.map(({ reviewedSha256: _reviewedSha256, ...entry }) => entry)).toEqual(
      expectedConsumers
    );
    expect(audit.consumers.every(({ routingAuthority }) => routingAuthority === false)).toBe(true);
    expect(
      audit.consumers.every(
        ({ file, reviewedSha256 }) => reviewedSha256 === fileSha256(resolve(repoRoot, file))
      )
    ).toBe(true);
    expect(audit.literalReferences).toEqual(discoverIdentityTagReferences());
    expect(audit.pendingLiveGates).toEqual(expectedPendingLiveGates);
  });

  it('rejects unknown fields, duplicate entries, stale review hashes, and semantic drift', () => {
    const audit = readIdentityAudit();
    expect(() => validateIdentityAudit(audit)).not.toThrow();

    expect(() => validateIdentityAudit({ ...audit, unexpected: true })).toThrow(
      'unknown or missing keys'
    );

    const duplicate = structuredClone(audit);
    duplicate.runtimeWorkspaceClosure.packages.push(
      structuredClone(duplicate.runtimeWorkspaceClosure.packages[0] as RuntimeWorkspacePackage)
    );
    expect(() => validateIdentityAudit(duplicate)).toThrow('duplicate');

    const staleBundleClosure = structuredClone(audit);
    staleBundleClosure.runtimeBundleClosure.inputCount += 1;
    expect(() => validateIdentityAudit(staleBundleClosure)).toThrow(
      'runtimeBundleClosure is stale'
    );

    const staleIdentityBoundary = structuredClone(audit);
    staleIdentityBoundary.observabilityIdentityBoundary.serviceWiring.reviewedSha256 = '0'.repeat(
      64
    );
    expect(() => validateIdentityAudit(staleIdentityBoundary)).toThrow(
      'observabilityIdentityBoundary.serviceWiring.reviewedSha256 is stale'
    );

    const identityBoundaryDrift = structuredClone(audit);
    identityBoundaryDrift.observabilityIdentityBoundary.sink.property =
      'codeAgentUrl' as 'environment';
    expect(() => validateIdentityAudit(identityBoundaryDrift)).toThrow(
      'observabilityIdentityBoundary.sink does not match the reviewed semantic contract'
    );

    const entryPointDrift = structuredClone(audit);
    entryPointDrift.runtimeBundleClosure.entryPoints[0] = 'workers/orchestrator/src/start.ts';
    expect(() => validateIdentityAudit(entryPointDrift)).toThrow('semantic contract');

    const untrimmed = structuredClone(audit);
    untrimmed.consumers[0] = {
      ...(untrimmed.consumers[0] as IdentityAudit['consumers'][number]),
      purpose: ` ${(untrimmed.consumers[0] as IdentityAudit['consumers'][number]).purpose}`,
    };
    expect(() => validateIdentityAudit(untrimmed)).toThrow('trimmed non-empty string');

    const staleConsumer = structuredClone(audit);
    (staleConsumer.consumers[0] as ReviewedIdentityConsumer).reviewedSha256 = '0'.repeat(64);
    expect(() => validateIdentityAudit(staleConsumer)).toThrow('reviewedSha256 is stale');

    const callbackDrift = structuredClone(audit);
    callbackDrift.callbackOwner['INTEXURAOS_CODE_AGENT_URL'] = {
      value: 'https://dev.intexuraos.cloud/api/code',
      valueClass: 'production-code-agent-base',
    };
    expect(() => validateIdentityAudit(callbackDrift)).toThrow('semantic contract');

    const routingDrift = structuredClone(audit);
    routingDrift.routingAuthorities[0] = 'workerLocation';
    expect(() => validateIdentityAudit(routingDrift)).toThrow('semantic contract');

    const credentialDrift = structuredClone(audit);
    credentialDrift.credentialAuthorities[0] = 'INTEXURAOS_ENVIRONMENT';
    expect(() => validateIdentityAudit(credentialDrift)).toThrow('semantic contract');

    const tagDrift = structuredClone(audit);
    tagDrift.fixedTags['INTEXURAOS_ENVIRONMENT'] = {
      value: 'prod',
      valueClass: 'legacy-host-observability-tag',
    };
    expect(() => validateIdentityAudit(tagDrift)).toThrow('semantic contract');

    const sinkDrift = structuredClone(audit);
    (sinkDrift.consumers[0] as ReviewedIdentityConsumer).sinkClassification =
      'sentry-runtime-tag-sink';
    expect(() => validateIdentityAudit(sinkDrift)).toThrow('not allowed');

    const missingUsage = structuredClone(audit);
    (missingUsage.consumers[0] as ReviewedIdentityConsumer).usageBindings = [];
    expect(() => validateIdentityAudit(missingUsage)).toThrow('must be a non-empty array');

    const staleUsage = structuredClone(audit);
    const usageBinding = (staleUsage.consumers[0] as ReviewedIdentityConsumer).usageBindings[0];
    if (usageBinding === undefined) throw new Error('fixture usage binding is missing');
    usageBinding.spanSha256 = '0'.repeat(64);
    expect(() => validateIdentityAudit(staleUsage)).toThrow('spanSha256 is stale');

    const movedUsage = structuredClone(audit);
    const movedBinding = (movedUsage.consumers[0] as ReviewedIdentityConsumer).usageBindings[0];
    if (movedBinding === undefined) throw new Error('fixture usage binding is missing');
    movedBinding.column += 1;
    expect(() => validateIdentityAudit(movedUsage)).toThrow('one exact AST usage');
  }, 120_000);

  it('rejects duplicate JSON object keys before parsing the audit contract', () => {
    expect(() => parseStrictJson('{"scope":"first","scope":"second"}', 'duplicate.json')).toThrow(
      'duplicate object key: scope'
    );
    expect(() => parseStrictJson('{"outer":{"tag":1,"tag":2}}', 'nested.json')).toThrow(
      'duplicate object key: tag'
    );
    expect(() => parseStrictJson('{"tag":1,"\\u0074ag":2}', 'escaped.json')).toThrow(
      'duplicate object key: tag'
    );
  });

  it('documents why dev tags remain while production owns callbacks', () => {
    const decision = readFileSync(identityDecisionPath, 'utf8');

    expect(decision).toContain('Status: Accepted');
    expect(decision).toContain('INTEXURAOS_ENVIRONMENT=dev');
    expect(decision).toContain('INTEXURAOS_RUNTIME=dev');
    expect(decision).toContain('https://intexuraos.cloud/api/code');
    expect(decision).toContain('not callback-routing authority');
    expect(decision).toContain('Every literal `(environment variable, file)` pair');
    expect(decision).toContain('real esbuild');
    expect(decision).toContain('package `exports`');
    expect(decision).toContain('BootstrapEnvConfig` deliberately does not expose');
    expect(decision).toContain('private branded');
    expect(decision).toContain('sole production');
    expect(decision).toContain('Audit schema v6');
    expect(decision).toContain('credential-principal-metadata');
    expect(decision).toContain('prod-hmac-internal-auth-secret-match');
  });
});
