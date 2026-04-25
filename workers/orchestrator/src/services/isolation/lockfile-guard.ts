import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Logger } from '@intexuraos/common-core';

export class LockfileIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockfileIntegrityError';
  }
}

export function computeLockfileSha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function snapshotLockfile(worktreePath: string): string | null {
  const lockfilePath = path.join(worktreePath, 'pnpm-lock.yaml');
  if (!fs.existsSync(lockfilePath)) {
    return null;
  }
  return computeLockfileSha256(fs.readFileSync(lockfilePath));
}

interface PnpmLock {
  packages?: Record<string, PnpmLockPackage>;
}

interface PnpmLockPackage {
  resolution?: Record<string, unknown> | string;
}

export function assertLockfileIntegrity(yamlContent: string): void {
  const parsed = parseYaml(yamlContent) as PnpmLock | null;
  const packages = parsed?.packages ?? {};
  for (const [pkgKey, pkg] of Object.entries(packages)) {
    const resolution = pkg.resolution;
    if (resolution === undefined || typeof resolution !== 'object') {
      throw new LockfileIntegrityError(`package ${pkgKey} has no structured resolution block`);
    }
    const integrity = resolution['integrity'];
    if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
      throw new LockfileIntegrityError(`package ${pkgKey} missing sha512 integrity`);
    }
    const tarball = resolution['tarball'];
    if (typeof tarball === 'string') {
      // Allow only canonical npm registry tarballs.
      if (!tarball.startsWith('https://registry.npmjs.org/')) {
        throw new LockfileIntegrityError(`package ${pkgKey} has disallowed resolution: ${tarball}`);
      }
    }
  }
}

/**
 * Audits the worktree's pnpm-lock.yaml against {@link assertLockfileIntegrity}
 * and emits a structured warn log on any violation. Non-fatal by design — real
 * pnpm-lock files in this monorepo carry only registry packages with sha512
 * integrity, so any failure here represents either tampering or an unexpected
 * lockfile shape that warrants human review before the worker proceeds. Using
 * warn (not throw) means a transient parser quirk cannot wedge worker creation,
 * but the structured event is still actionable for downstream alerting.
 */
export function auditLockfile(worktreePath: string, taskId: string, logger: Logger): void {
  const lockfilePath = path.join(worktreePath, 'pnpm-lock.yaml');
  if (!fs.existsSync(lockfilePath)) {
    return;
  }
  let yamlContent: string;
  try {
    yamlContent = fs.readFileSync(lockfilePath, 'utf-8');
  } catch (error) {
    logger.warn(
      { taskId, error, event: 'lockfile-audit-read-failed' },
      'Failed to read lockfile for audit'
    );
    return;
  }
  try {
    assertLockfileIntegrity(yamlContent);
  } catch (error) {
    // String(error) handles both Error subclasses (renders as "Name: message",
    // more informative than .message alone) and the rare non-Error throw —
    // single code path, no untested branches.
    logger.warn(
      { taskId, event: 'lockfile-audit-violation', reason: String(error) },
      'pnpm-lock.yaml failed integrity audit — review before merging'
    );
  }
}
