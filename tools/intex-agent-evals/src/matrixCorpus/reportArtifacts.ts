import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MatrixCorpusReportV1Schema,
  renderMatrixCorpusReportMarkdown,
  type MatrixCorpusReportV1,
} from './reportSchema.js';

export interface MatrixCorpusArtifactPort {
  ensurePrivateDirectory(path: string): Promise<boolean>;
  writePrivateExclusive(path: string, contents: string): Promise<boolean>;
  replacePrivate(path: string, contents: string): Promise<boolean>;
  rename(source: string, destination: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  removeExactPrivateDirectory(path: string): Promise<'removed' | 'missing' | 'failed'>;
}

export interface MatrixCorpusArtifactDeliveryPort {
  recordStaged(input: {
    runId: string;
    jsonDigest: string;
    markdownDigest: string;
  }): Promise<{ ok: true; revision: number } | { ok: false }>;
  markReady(input: { runId: string; jsonDigest: string; markdownDigest: string }): Promise<boolean>;
  markFailed(input: {
    runId: string;
    code: 'REPORT_STAGING_FAILED' | 'REPORT_VALIDATION_FAILED' | 'REPORT_PUBLICATION_FAILED';
  }): Promise<void>;
}

export interface StagedMatrixCorpusArtifacts {
  readonly runId: string;
  readonly stagingDirectory: string;
  readonly reportDirectory: string;
  readonly stagedJsonPath: string;
  readonly stagedMarkdownPath: string;
  readonly jsonDigest: string;
  readonly markdownDigest: string;
  readonly artifactStageDigest: string;
  readonly revision: number;
}

const sha256 = (contents: string): string =>
  createHash('sha256').update(contents, 'utf8').digest('hex');

export async function stageMatrixCorpusArtifacts(input: {
  readonly artifactRoot: string;
  readonly report: MatrixCorpusReportV1;
  readonly files: MatrixCorpusArtifactPort;
  readonly delivery: MatrixCorpusArtifactDeliveryPort;
}): Promise<
  | { ok: true; value: StagedMatrixCorpusArtifacts }
  | { ok: false; code: 'REPORT_VALIDATION_FAILED' | 'REPORT_STAGING_FAILED' }
> {
  let report: MatrixCorpusReportV1;
  let json: string;
  let markdown: string;
  try {
    report = MatrixCorpusReportV1Schema.parse(input.report);
    if (report.artifactDelivery.status !== 'pending') throw new Error('invalid stage state');
    json = `${JSON.stringify(report, null, 2)}\n`;
    markdown = renderMatrixCorpusReportMarkdown(report);
  } catch {
    await input.delivery.markFailed({
      runId: input.report.runId,
      code: 'REPORT_VALIDATION_FAILED',
    });
    return { ok: false, code: 'REPORT_VALIDATION_FAILED' };
  }

  const stagingDirectory = join(input.artifactRoot, `.${report.runId}.staging`);
  const reportDirectory = join(input.artifactRoot, report.runId);
  const stagedJsonPath = join(stagingDirectory, '.report.json.staged');
  const stagedMarkdownPath = join(stagingDirectory, '.report.md.staged');
  const jsonDigest = sha256(json);
  const markdownDigest = sha256(markdown);
  const artifactStageDigest = sha256(
    JSON.stringify({ jsonCandidateDigest: jsonDigest, markdownCandidateDigest: markdownDigest })
  );
  if (
    !(await input.files.ensurePrivateDirectory(stagingDirectory)) ||
    !(await input.files.writePrivateExclusive(stagedJsonPath, json)) ||
    !(await input.files.writePrivateExclusive(stagedMarkdownPath, markdown))
  ) {
    await input.files.removeExactPrivateDirectory(stagingDirectory);
    await input.delivery.markFailed({ runId: report.runId, code: 'REPORT_STAGING_FAILED' });
    return { ok: false, code: 'REPORT_STAGING_FAILED' };
  }
  const recorded = await input.delivery.recordStaged({
    runId: report.runId,
    jsonDigest,
    markdownDigest,
  });
  if (!recorded.ok) {
    await input.files.removeExactPrivateDirectory(stagingDirectory);
    await input.delivery.markFailed({ runId: report.runId, code: 'REPORT_STAGING_FAILED' });
    return { ok: false, code: 'REPORT_STAGING_FAILED' };
  }
  return {
    ok: true,
    value: {
      runId: report.runId,
      stagingDirectory,
      reportDirectory,
      stagedJsonPath,
      stagedMarkdownPath,
      jsonDigest,
      markdownDigest,
      artifactStageDigest,
      revision: recorded.revision,
    },
  };
}

export async function publishMatrixCorpusArtifacts(input: {
  readonly staged: StagedMatrixCorpusArtifacts;
  readonly report: MatrixCorpusReportV1;
  readonly terminalAcknowledged: boolean;
  readonly leaseReleased: boolean;
  readonly files: MatrixCorpusArtifactPort;
  readonly delivery: MatrixCorpusArtifactDeliveryPort;
}): Promise<
  | { ok: true; reportDirectory: string }
  | { ok: false; code: 'REPORT_VALIDATION_FAILED' | 'REPORT_PUBLICATION_FAILED' }
> {
  const fail = async (
    code: 'REPORT_VALIDATION_FAILED' | 'REPORT_PUBLICATION_FAILED'
  ): Promise<{ ok: false; code: 'REPORT_VALIDATION_FAILED' | 'REPORT_PUBLICATION_FAILED' }> => {
    await input.files.removeExactPrivateDirectory(input.staged.stagingDirectory);
    await input.delivery.markFailed({ runId: input.staged.runId, code });
    return { ok: false as const, code };
  };
  let report: MatrixCorpusReportV1;
  let json: string;
  let markdown: string;
  try {
    if (!input.terminalAcknowledged || !input.leaseReleased) throw new Error('terminal barrier');
    report = MatrixCorpusReportV1Schema.parse(input.report);
    if (report.artifactDelivery.status !== 'ready') throw new Error('invalid publish state');
    if (
      report.runId !== input.staged.runId ||
      report.artifactDelivery.stagedJsonDigest !== input.staged.jsonDigest ||
      report.artifactDelivery.stagedMarkdownDigest !== input.staged.markdownDigest ||
      input.staged.artifactStageDigest !==
        sha256(
          JSON.stringify({
            jsonCandidateDigest: input.staged.jsonDigest,
            markdownCandidateDigest: input.staged.markdownDigest,
          })
        )
    )
      throw new Error('staged artifact binding mismatch');
    json = `${JSON.stringify(report, null, 2)}\n`;
    markdown = renderMatrixCorpusReportMarkdown(report);
  } catch {
    return await fail('REPORT_VALIDATION_FAILED');
  }
  const jsonPath = join(input.staged.stagingDirectory, 'report.json');
  const markdownPath = join(input.staged.stagingDirectory, 'report.md');
  const commitPath = join(input.staged.stagingDirectory, 'report.commit.json');
  const jsonDigest = sha256(json);
  const markdownDigest = sha256(markdown);
  if (
    !(await input.files.replacePrivate(jsonPath, json)) ||
    !(await input.files.replacePrivate(markdownPath, markdown)) ||
    !(await input.files.replacePrivate(
      commitPath,
      `${JSON.stringify({
        schemaVersion: 1,
        runId: report.runId,
        jsonDigest,
        markdownDigest,
      })}\n`
    ))
  )
    return await fail('REPORT_PUBLICATION_FAILED');

  await Promise.all([
    input.files.remove(input.staged.stagedJsonPath),
    input.files.remove(input.staged.stagedMarkdownPath),
  ]);
  if (!(await input.files.rename(input.staged.stagingDirectory, input.staged.reportDirectory))) {
    return await fail('REPORT_PUBLICATION_FAILED');
  }
  if (!(await input.delivery.markReady({ runId: report.runId, jsonDigest, markdownDigest }))) {
    await input.files.removeExactPrivateDirectory(input.staged.reportDirectory);
    return await fail('REPORT_PUBLICATION_FAILED');
  }
  return { ok: true, reportDirectory: input.staged.reportDirectory };
}

export function createNodeMatrixCorpusArtifactPort(): MatrixCorpusArtifactPort {
  async function writePrivate(
    path: string,
    contents: string,
    exclusive: boolean
  ): Promise<boolean> {
    try {
      const handle = await open(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_NOFOLLOW |
          (exclusive ? constants.O_EXCL : constants.O_TRUNC),
        0o600
      );
      try {
        await handle.chmod(0o600);
        await handle.writeFile(contents, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      const metadata = await stat(path);
      return (
        metadata.isFile() &&
        (metadata.mode & 0o7777) === 0o600 &&
        metadata.uid === process.getuid?.()
      );
    } catch {
      return false;
    }
  }
  return {
    async ensurePrivateDirectory(
      path
    ): ReturnType<MatrixCorpusArtifactPort['ensurePrivateDirectory']> {
      try {
        await mkdir(path, { recursive: true, mode: 0o700 });
        await chmod(path, 0o700);
        const metadata = await lstat(path);
        return (
          metadata.isDirectory() &&
          !metadata.isSymbolicLink() &&
          (metadata.mode & 0o7777) === 0o700 &&
          metadata.uid === process.getuid?.()
        );
      } catch {
        return false;
      }
    },
    writePrivateExclusive: async (path, contents) => await writePrivate(path, contents, true),
    replacePrivate: async (path, contents) => await writePrivate(path, contents, false),
    async rename(source, destination): ReturnType<MatrixCorpusArtifactPort['rename']> {
      try {
        await rename(source, destination);
        return true;
      } catch {
        return false;
      }
    },
    async remove(path): ReturnType<MatrixCorpusArtifactPort['remove']> {
      await rm(path, { force: true }).catch(() => undefined);
    },
    async removeExactPrivateDirectory(
      path
    ): ReturnType<MatrixCorpusArtifactPort['removeExactPrivateDirectory']> {
      try {
        const metadata = await lstat(path);
        if (
          !metadata.isDirectory() ||
          metadata.isSymbolicLink() ||
          (metadata.mode & 0o7777) !== 0o700 ||
          metadata.uid !== process.getuid?.()
        )
          return 'failed';
        await rm(path, { recursive: true, force: false });
        return 'removed';
      } catch (error) {
        return isMissingFileError(error) ? 'missing' : 'failed';
      }
    },
  };
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export interface MatrixCorpusRetentionRecord {
  readonly runId: string;
  readonly leaseFence: string;
  readonly startedAt: string;
  readonly lifecycle: 'preflight' | 'running' | 'finalizing' | 'completed' | 'stopped';
  readonly verdict: 'pending' | 'passed' | 'failed' | 'not_evaluated';
  readonly artifactDelivery: 'pending' | 'staged' | 'ready' | 'failed' | 'unknown';
  readonly completedAt: string | null;
  readonly isCurrent: boolean;
}

export function selectMatrixCorpusRetention(records: readonly MatrixCorpusRetentionRecord[]): {
  readonly retainRunIds: readonly string[];
  readonly evict: readonly MatrixCorpusRetentionRecord[];
} {
  const terminal = records.filter(
    (record) => record.lifecycle === 'completed' || record.lifecycle === 'stopped'
  );
  const byLatest = (
    left: MatrixCorpusRetentionRecord,
    right: MatrixCorpusRetentionRecord
  ): number =>
    right.startedAt.localeCompare(left.startedAt) || right.runId.localeCompare(left.runId);
  const retain = new Set<string>();
  for (const record of records) {
    if (
      record.isCurrent &&
      (!terminal.includes(record) ||
        record.artifactDelivery === 'pending' ||
        record.artifactDelivery === 'staged')
    )
      retain.add(record.runId);
  }
  const latestPass = terminal
    .filter((record) => record.verdict === 'passed' && record.artifactDelivery === 'ready')
    .sort(byLatest)[0];
  if (latestPass !== undefined) retain.add(latestPass.runId);
  const current = records.find((record) => record.isCurrent);
  const currentFailed = terminal.find(
    (record) =>
      record.isCurrent &&
      (record.verdict !== 'passed' ||
        record.artifactDelivery === 'failed' ||
        record.artifactDelivery === 'unknown')
  );
  const latestFailed = terminal
    .filter(
      (record) =>
        record.verdict !== 'passed' ||
        record.artifactDelivery === 'failed' ||
        record.artifactDelivery === 'unknown'
    )
    .sort(byLatest)[0];
  if (currentFailed !== undefined) retain.add(currentFailed.runId);
  else if (current === undefined && latestFailed !== undefined) retain.add(latestFailed.runId);
  return {
    retainRunIds: [...retain].sort(),
    evict: terminal.filter((record) => !retain.has(record.runId)).sort(byLatest),
  };
}

export async function cleanupEvictedMatrixCorpusRuns(input: {
  readonly provisioningRunId: string;
  readonly provisioningLeaseFence: string;
  readonly beforeActivation: boolean;
  readonly records: readonly MatrixCorpusRetentionRecord[];
  readonly cleanupWhatsApp: (
    target: MatrixCorpusRetentionRecord
  ) => Promise<{ ok: boolean; targetRunId: string; targetLeaseFence: string }>;
  readonly cleanupIntex: (
    target: MatrixCorpusRetentionRecord
  ) => Promise<{ ok: boolean; runId: string; leaseFence: string }>;
}): Promise<{ ok: true; removed: number } | { ok: false; code: 'RETENTION_CLEANUP_FAILED' }> {
  if (
    !input.beforeActivation ||
    input.provisioningRunId === '' ||
    input.provisioningLeaseFence === ''
  )
    return { ok: false, code: 'RETENTION_CLEANUP_FAILED' };
  const selection = selectMatrixCorpusRetention(input.records);
  let removed = 0;
  for (const target of selection.evict) {
    const whatsapp = await input.cleanupWhatsApp(target);
    if (
      !whatsapp.ok ||
      whatsapp.targetRunId !== target.runId ||
      whatsapp.targetLeaseFence !== target.leaseFence
    )
      return { ok: false, code: 'RETENTION_CLEANUP_FAILED' };
    const intex = await input.cleanupIntex(target);
    if (!intex.ok || intex.runId !== target.runId || intex.leaseFence !== target.leaseFence)
      return { ok: false, code: 'RETENTION_CLEANUP_FAILED' };
    removed += 1;
  }
  return { ok: true, removed };
}
