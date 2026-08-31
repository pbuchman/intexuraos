import { createHash } from 'node:crypto';
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAlloyFlushEvidence,
  buildDevHostObservabilityFence,
  buildLastGoodActiveState,
  publishImmutableEvidence,
  runDevHostEvidenceCli,
} from '../lib/dev-hibernation-drain-collector.mjs';
import type {
  AlloyDebugSnapshot,
  LastGoodActiveState,
} from '../lib/dev-hibernation-drain-collector.mjs';

const runId = '20260828T002847Z-paddc4965d21e-b265702826912';
const nonce = 'a'.repeat(64);
const revision = '1'.repeat(40);
const hostRevision = '2'.repeat(40);
const digest = '3'.repeat(64);
const observedAt = '2026-08-29T10:00:00Z';
const units = [
  'pm2-pbuchman.service',
  'intexuraos-emulators.service',
  'pm2-journal-bridge.service',
  'intexuraos-log-viewer.service',
  'intexuraos-log-server.service',
  'alloy.service',
];
const ports = [4100, 8106];
const verifierSources = [
  'scripts/lib/dev-hibernation-drain-collector.mjs',
  'scripts/lib/dev-hibernation-drain-verifier.mjs',
  'tools/pubsub-ui/pubsub-drain.mjs',
];
const installedPolicy = {
  evidence: {
    alloyFileMatchSyncPeriodMs: 10_000,
    alloyFlushFilePrefix: 'alloy-flush-',
    hostRoot: '/var/lib/intexuraos-dev/evidence',
    lastGoodFileName: 'last-good-active-state.json',
    maxSnapshotAgeMs: 30_000,
    minimumStableIntervalMs: 20_000,
    observerPollIntervalMs: 1_000,
  },
  ports: { candidate: ports },
  signedDrain: { maxArtifactAgeMs: 900_000, sourceFiles: verifierSources },
  units: { stopSet: units },
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function fixture(evidenceDirectory: string): LastGoodActiveState {
  const valueByName = {
    activeHealth: {
      checks: ['internal-http-matrix'],
      evidenceRunId: runId,
      observedAt,
      result: 'PASS',
    },
    externalIntegrations: {
      evidenceRunId: runId,
      observedAt,
      states: { tasker: 'paused' },
    },
    secretPackage: {
      evidenceRunId: runId,
      observedAt,
      projectionIds: ['dev-package-v1'],
      version: 1,
    },
    serviceAccountPrincipal: {
      evidenceRunId: runId,
      id: 'home-runtime',
      kind: 'service-account',
      observedAt,
    },
  };
  const referencedObjects = Object.fromEntries(
    Object.entries(valueByName).map(([name, value]) => [
      name,
      ((): { path: string; sha256: string; value: typeof value } => {
        const path = join(evidenceDirectory, `${name}.json`);
        const bytes = `${canonicalJson(value)}\n`;
        writeFileSync(path, bytes, { mode: 0o600 });
        chmodSync(path, 0o600);
        return {
          path,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          value,
        };
      })(),
    ])
  ) as LastGoodActiveState['referencedObjects'];
  return {
    schemaVersion: 1,
    evidenceRunId: runId,
    intexuraosRevision: revision,
    pbuchmanDevRevision: hostRevision,
    installManifestSha256: digest,
    profile: {
      mode: 'active-post-cutover',
      path: `/var/lib/intexuraos-dev/profiles/${revision}/active-post-cutover.caddy`,
      revision,
      sha256: digest,
    },
    unitFileStates: Object.fromEntries(units.map((unit) => [unit, 'enabled'])),
    expectedCandidatePorts: ports,
    staticReleaseTarget: `/var/www/intexuraos-dev/releases/${revision}`,
    staticReleaseFiles: { 'index.html': digest },
    pm2EcosystemPath: '/home/pbuchman/deploy/intexuraos/ecosystem.config.cjs',
    pm2EcosystemSha256: digest,
    pm2Processes: [
      {
        cwd: '/home/pbuchman/deploy/intexuraos',
        execPath: '/home/pbuchman/deploy/intexuraos/apps/app.mjs',
        name: 'app',
        status: 'online',
      },
    ],
    composeCheckoutRevision: revision,
    composeFileSha256: digest,
    imageDigests: [`sha256:${'4'.repeat(64)}`, `sha256:${'5'.repeat(64)}`],
    referencedObjects,
    devDrainSourceRevisions: { orchestrator: '6'.repeat(40), pubsub: '7'.repeat(40) },
    devDrainNodeSha256: digest,
    devDrainNodeVersion: 'v22.22.0',
    devDrainVerifierSources: Object.fromEntries(verifierSources.map((source) => [source, digest])),
  };
}

function buildOptions(evidenceDirectory: string): Parameters<typeof buildLastGoodActiveState>[1] {
  return {
    evidenceDirectory,
    expectedCandidatePorts: ports,
    expectedUnits: units,
    expectedVerifierSources: verifierSources,
    maxReferenceAgeMs: 900_000,
    now: (): Date => new Date('2026-08-29T10:10:00Z'),
    profileRoot: '/var/lib/intexuraos-dev/profiles',
    referenceGroupId: process.getgid?.() ?? 0,
    referenceOwnerId: process.getuid?.() ?? 0,
    staticReleaseRoot: '/var/www/intexuraos-dev/releases',
  };
}

describe('DEV hibernation host evidence builders', () => {
  it('builds only the exact last-good contract while reference observations are fresh', () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dev-last-good-')));
    const lastGood = buildLastGoodActiveState(fixture(directory), buildOptions(directory));

    expect(Object.keys(lastGood).sort()).toEqual(Object.keys(fixture(directory)).sort());
    expect(Object.isFrozen(lastGood)).toBe(true);
    expect(lastGood.referencedObjects.secretPackage.value.version).toBe(1);
  });

  it('rejects stale capture inputs and every unknown field instead of preserving it', () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dev-last-good-')));
    const stale = fixture(directory);
    stale.referencedObjects.activeHealth.value.observedAt = '2026-08-29T09:44:59Z';
    const staleBytes = `${canonicalJson(stale.referencedObjects.activeHealth.value)}\n`;
    writeFileSync(stale.referencedObjects.activeHealth.path, staleBytes);
    stale.referencedObjects.activeHealth.sha256 = createHash('sha256')
      .update(staleBytes)
      .digest('hex');
    expect(() => buildLastGoodActiveState(stale, buildOptions(directory))).toThrow(/fresh/u);

    const unexpected = { ...fixture(directory), token: 'must-never-be-preserved' };
    expect(() => buildLastGoodActiveState(unexpected, buildOptions(directory))).toThrow(
      /privacy-safe contract/u
    );
  });

  it('binds every embedded reference to private canonical bytes and the actual SHA-256', () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dev-last-good-')));

    const missing = fixture(directory);
    unlinkSync(missing.referencedObjects.activeHealth.path);
    expect(() => buildLastGoodActiveState(missing, buildOptions(directory))).toThrow();

    const hashMismatch = fixture(directory);
    hashMismatch.referencedObjects.activeHealth.sha256 = digest;
    expect(() => buildLastGoodActiveState(hashMismatch, buildOptions(directory))).toThrow(
      /hash mismatch/u
    );

    const embeddedMismatch = fixture(directory);
    embeddedMismatch.referencedObjects.activeHealth.value.checks = ['fabricated'];
    expect(() => buildLastGoodActiveState(embeddedMismatch, buildOptions(directory))).toThrow(
      /embedded value/u
    );
  });

  it('rejects symlink, hardlink, wrong metadata, path escape, and a read race', () => {
    const symlinkDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'dev-last-good-')));
    const symlinkFixture = fixture(symlinkDirectory);
    const activePath = symlinkFixture.referencedObjects.activeHealth.path;
    const realPath = join(symlinkDirectory, 'activeHealth-real.json');
    writeFileSync(realPath, readFileSync(activePath), { mode: 0o600 });
    unlinkSync(activePath);
    symlinkSync(realPath, activePath);
    expect(() => buildLastGoodActiveState(symlinkFixture, buildOptions(symlinkDirectory))).toThrow(
      /symlink|canonical/u
    );

    const hardlinkDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'dev-last-good-')));
    const hardlinkFixture = fixture(hardlinkDirectory);
    linkSync(
      hardlinkFixture.referencedObjects.activeHealth.path,
      join(hardlinkDirectory, 'second-link.json')
    );
    expect(() =>
      buildLastGoodActiveState(hardlinkFixture, buildOptions(hardlinkDirectory))
    ).toThrow(/metadata/u);

    const modeDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'dev-last-good-')));
    const modeFixture = fixture(modeDirectory);
    chmodSync(modeFixture.referencedObjects.activeHealth.path, 0o644);
    expect(() => buildLastGoodActiveState(modeFixture, buildOptions(modeDirectory))).toThrow(
      /metadata/u
    );
    expect(() =>
      buildLastGoodActiveState(fixture(modeDirectory), {
        ...buildOptions(modeDirectory),
        referenceOwnerId: (process.getuid?.() ?? 0) + 1,
      })
    ).toThrow(/metadata/u);

    const escapeDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'dev-last-good-')));
    const escapeFixture = fixture(escapeDirectory);
    const outsideDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'dev-last-good-outside-')));
    const outsidePath = join(outsideDirectory, 'activeHealth.json');
    writeFileSync(outsidePath, readFileSync(escapeFixture.referencedObjects.activeHealth.path), {
      mode: 0o600,
    });
    escapeFixture.referencedObjects.activeHealth.path = outsidePath;
    expect(() => buildLastGoodActiveState(escapeFixture, buildOptions(escapeDirectory))).toThrow(
      /protected evidence directory/u
    );

    const raceDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'dev-last-good-')));
    const raceFixture = fixture(raceDirectory);
    expect(() =>
      buildLastGoodActiveState(raceFixture, {
        ...buildOptions(raceDirectory),
        referenceReadHook: (path: string, name: string) => {
          if (name === 'activeHealth') writeFileSync(path, ' ', { flag: 'a' });
        },
      })
    ).toThrow(/changed during read/u);
  });

  it('builds only nonce-bound PASS Alloy and exact 11-key fence artifacts', () => {
    const alloy = buildAlloyFlushEvidence({
      bufferFlushComplete: true,
      evidenceRunId: runId,
      observedAt,
      operationNonce: nonce,
      pm2Only: true,
      result: 'PASS',
      schemaVersion: 1,
    });
    expect(Object.keys(alloy)).toHaveLength(7);

    const fence = buildDevHostObservabilityFence({
      artifactType: 'dev-host-observability-fence',
      bufferFlushComplete: true,
      continuityHealthy: true,
      evidenceRunId: runId,
      observedAt,
      operationNonce: nonce,
      pendingBufferCount: 0,
      phase: 'terminal-log-tail',
      result: 'PASS',
      schemaVersion: 1,
      terminalTailComplete: true,
    });
    expect(Object.keys(fence)).toHaveLength(11);

    expect(() => buildAlloyFlushEvidence({ ...alloy, operationNonce: 'short' })).toThrow(/nonce/u);
    expect(() => buildDevHostObservabilityFence({ ...fence, pendingBufferCount: 1 })).toThrow(
      /PASS/u
    );
  });
});

describe('immutable evidence publication', () => {
  it('publishes last-good only through the installed-policy CLI closure', async () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dev-evidence-cli-')));
    chmodSync(directory, 0o700);
    const ownerId = process.getuid?.() ?? 0;
    const groupId = process.getgid?.() ?? 0;
    const input = fixture(directory);
    const inputPath = join(directory, 'last-good-active-state.input.json');
    writeFileSync(inputPath, `${canonicalJson(input)}\n`, { mode: 0o600 });

    const result = (await runDevHostEvidenceCli(
      ['publish-last-good', '--evidence-dir', directory, '--input', inputPath],
      {
        allowNonRoot: true,
        groupId,
        now: (): Date => new Date('2026-08-29T10:10:00Z'),
        ownerId,
        policy: installedPolicy,
      }
    )) as { fileName: string; path: string; sha256: string };

    expect(result.fileName).toBe('last-good-active-state.json');
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.parse(readFileSync(result.path, 'utf8'))).toEqual(input);
  });

  it('publishes canonical mode-0600 bytes once and never replaces the final path', () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dev-evidence-publish-')));
    chmodSync(directory, 0o700);
    const ownerId = process.getuid?.() ?? 0;
    const value = buildAlloyFlushEvidence({
      bufferFlushComplete: true,
      evidenceRunId: runId,
      observedAt,
      operationNonce: nonce,
      pm2Only: true,
      result: 'PASS',
      schemaVersion: 1,
    });
    const first = publishImmutableEvidence({
      directory,
      fileName: `alloy-flush-${nonce}.json`,
      ownerId,
      value,
    });
    const original = readFileSync(first.path);

    expect(lstatSync(first.path).mode & 0o777).toBe(0o600);
    expect(lstatSync(first.path).nlink).toBe(1);
    expect(first.sha256).toBe(createHash('sha256').update(original).digest('hex'));
    expect(() =>
      publishImmutableEvidence({ directory, fileName: first.fileName, ownerId, value })
    ).toThrow(/already exists/u);
    expect(readFileSync(first.path)).toEqual(original);
  });

  it('publishes a nonce-bound Alloy preflight through the guarded CLI contract', async () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dev-evidence-cli-')));
    chmodSync(directory, 0o700);
    const ownerId = process.getuid?.() ?? 0;
    const groupId = process.getgid?.() ?? 0;
    const alloySnapshot = (capturedAt: string, lines: number): AlloyDebugSnapshot => ({
      capturedAt,
      configSha256: digest,
      invocationId: '8'.repeat(32),
      mainPid: 105,
      pm2Only: true,
      source: {
        activeFilesTotal: 2,
        fileBytesTotal: lines * 10,
        readBytesTotal: lines * 10,
        readLinesTotal: lines,
      },
      write: { batchRetriesTotal: 0, droppedEntriesTotal: 0, sentEntriesTotal: lines },
    });
    const input = {
      baseline: alloySnapshot('2026-08-29T10:00:00Z', 1),
      evidenceRunId: runId,
      expectedFileCount: 2,
      first: alloySnapshot('2026-08-29T10:00:20Z', 2),
      minimumStableIntervalMs: 20_000,
      operationNonce: nonce,
      second: alloySnapshot('2026-08-29T10:00:40Z', 2),
    };
    const inputPath = join(directory, 'alloy-proof-input.json');
    writeFileSync(inputPath, `${canonicalJson({ ...input, minimumStableIntervalMs: 1_000 })}\n`, {
      mode: 0o600,
    });
    await expect(
      runDevHostEvidenceCli(
        ['publish-alloy-preflight', '--evidence-dir', directory, '--input', inputPath],
        { allowNonRoot: true, groupId, ownerId, policy: installedPolicy }
      )
    ).rejects.toThrow(/interval differs/u);
    writeFileSync(inputPath, `${canonicalJson(input)}\n`, { mode: 0o600 });

    const result = (await runDevHostEvidenceCli(
      ['publish-alloy-preflight', '--evidence-dir', directory, '--input', inputPath],
      { allowNonRoot: true, groupId, ownerId, policy: installedPolicy }
    )) as { fileName: string; path: string };

    expect(result.fileName).toBe(`alloy-flush-${nonce}.json`);
    expect(JSON.parse(readFileSync(result.path, 'utf8'))).toMatchObject({
      operationNonce: nonce,
      result: 'PASS',
    });
  });

  it('rejects escaping names and a pre-existing symlink', () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dev-evidence-publish-')));
    chmodSync(directory, 0o700);
    const ownerId = process.getuid?.() ?? 0;
    expect(() =>
      publishImmutableEvidence({ directory, fileName: '../escape.json', ownerId, value: {} })
    ).toThrow(/file name/u);

    const fileName = `alloy-flush-${nonce}.json`;
    symlinkSync('/dev/null', join(directory, fileName));
    expect(() => publishImmutableEvidence({ directory, fileName, ownerId, value: {} })).toThrow(
      /already exists/u
    );
  });

  it('does not clobber a destination created in the final publication race', () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dev-evidence-publish-')));
    chmodSync(directory, 0o700);
    const ownerId = process.getuid?.() ?? 0;
    const fileName = `alloy-flush-${nonce}.json`;
    const racedBytes = Buffer.from('{"raced":true}\n');
    expect(() =>
      publishImmutableEvidence({
        beforePublish: ({ finalPath }: { finalPath: string }) => {
          writeFileSync(finalPath, racedBytes, { flag: 'wx', mode: 0o600 });
        },
        directory,
        fileName,
        ownerId,
        value: { safe: true },
      })
    ).toThrow(/already exists/u);
    expect(readFileSync(join(directory, fileName))).toEqual(racedBytes);
  });
});
