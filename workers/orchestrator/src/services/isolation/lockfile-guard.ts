import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';

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
      throw new LockfileIntegrityError(
        `package ${pkgKey} has no structured resolution block`
      );
    }
    const integrity = resolution['integrity'];
    if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
      throw new LockfileIntegrityError(
        `package ${pkgKey} missing sha512 integrity`
      );
    }
    const tarball = resolution['tarball'];
    if (typeof tarball === 'string') {
      // Allow only canonical npm registry tarballs.
      if (!tarball.startsWith('https://registry.npmjs.org/')) {
        throw new LockfileIntegrityError(
          `package ${pkgKey} has disallowed resolution: ${tarball}`
        );
      }
    }
  }
}
