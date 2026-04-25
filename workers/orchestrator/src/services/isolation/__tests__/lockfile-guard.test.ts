import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeLockfileSha256,
  snapshotLockfile,
  assertLockfileIntegrity,
  auditLockfile,
  LockfileIntegrityError,
} from '../lockfile-guard.js';

const createMockLogger = (): Logger => ({
  info: vi.fn() as unknown as Logger['info'],
  warn: vi.fn() as unknown as Logger['warn'],
  error: vi.fn() as unknown as Logger['error'],
  debug: vi.fn() as unknown as Logger['debug'],
});

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'lockfile');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf-8');
}

describe('LockfileGuard', () => {
  describe('computeLockfileSha256', () => {
    it('returns deterministic hex digest', () => {
      const a = computeLockfileSha256('hello');
      const b = computeLockfileSha256('hello');
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('detects content changes', () => {
      expect(computeLockfileSha256('hello')).not.toBe(computeLockfileSha256('hello!'));
    });
  });

  describe('assertLockfileIntegrity', () => {
    it('accepts a clean lockfile with sha512 integrity on every package', () => {
      expect(() => assertLockfileIntegrity(readFixture('clean.yaml'))).not.toThrow();
    });

    it('rejects packages without integrity field', () => {
      expect(() => assertLockfileIntegrity(readFixture('missing-integrity.yaml'))).toThrow(
        LockfileIntegrityError
      );
    });

    it('rejects non-registry tarball resolutions even with integrity', () => {
      expect(() => assertLockfileIntegrity(readFixture('tarball-resolution.yaml'))).toThrow(
        /disallowed resolution/i
      );
    });

    it('accepts a registry tarball alongside integrity', () => {
      const yaml = `lockfileVersion: '9.0'
packages:
  ok@1.0.0:
    resolution:
      tarball: https://registry.npmjs.org/ok/-/ok-1.0.0.tgz
      integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==
`;
      expect(() => assertLockfileIntegrity(yaml)).not.toThrow();
    });

    it('accepts an empty / missing packages map', () => {
      // Covers `parsed?.packages ?? {}` fallback (parsed null and packages absent).
      expect(() => assertLockfileIntegrity('')).not.toThrow();
      expect(() => assertLockfileIntegrity("lockfileVersion: '9.0'\n")).not.toThrow();
    });

    it('rejects when resolution is a string (legacy shape)', () => {
      const yaml = `lockfileVersion: '9.0'
packages:
  legacy@1.0.0:
    resolution: 'sha1-XXXX'
`;
      expect(() => assertLockfileIntegrity(yaml)).toThrow(LockfileIntegrityError);
    });
  });

  describe('snapshotLockfile', () => {
    const tmpDirs: string[] = [];
    afterEach(() => {
      for (const dir of tmpDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('returns null when worktree has no pnpm-lock.yaml', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockfile-guard-'));
      tmpDirs.push(dir);
      expect(snapshotLockfile(dir)).toBeNull();
    });

    it('returns sha256 of pnpm-lock.yaml when present', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockfile-guard-'));
      tmpDirs.push(dir);
      fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'hello');
      expect(snapshotLockfile(dir)).toBe(computeLockfileSha256('hello'));
    });
  });

  describe('auditLockfile', () => {
    const tmpDirs: string[] = [];
    afterEach(() => {
      for (const dir of tmpDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('is a no-op when worktree has no pnpm-lock.yaml', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockfile-audit-'));
      tmpDirs.push(dir);
      const logger = createMockLogger();
      auditLockfile(dir, 'task-1', logger);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('does not warn on a clean lockfile', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockfile-audit-'));
      tmpDirs.push(dir);
      fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), readFixture('clean.yaml'));
      const logger = createMockLogger();
      auditLockfile(dir, 'task-2', logger);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('emits structured warn on integrity violation, never throws', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockfile-audit-'));
      tmpDirs.push(dir);
      fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), readFixture('tarball-resolution.yaml'));
      const logger = createMockLogger();
      expect(() => auditLockfile(dir, 'task-3', logger)).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-3',
          event: 'lockfile-audit-violation',
          // String(LockfileIntegrityError) renders as "<name>: <msg>".
          reason: expect.stringMatching(/LockfileIntegrityError.*disallowed resolution/i),
        }),
        expect.stringContaining('integrity audit')
      );
    });

    it('emits structured warn when readFileSync throws (e.g., permission denied)', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockfile-audit-'));
      tmpDirs.push(dir);
      // Create a directory at the lockfile path so readFileSync throws EISDIR.
      fs.mkdirSync(path.join(dir, 'pnpm-lock.yaml'));
      const logger = createMockLogger();
      expect(() => auditLockfile(dir, 'task-4', logger)).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-4',
          event: 'lockfile-audit-read-failed',
        }),
        expect.stringContaining('Failed to read lockfile')
      );
    });
  });
});
