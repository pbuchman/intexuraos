import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeLockfileSha256,
  assertLockfileIntegrity,
  LockfileIntegrityError,
} from '../lockfile-guard.js';

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'lockfile'
);

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
      expect(() => assertLockfileIntegrity(readFixture('missing-integrity.yaml')))
        .toThrow(LockfileIntegrityError);
    });

    it('rejects non-registry tarball resolutions even with integrity', () => {
      expect(() => assertLockfileIntegrity(readFixture('tarball-resolution.yaml')))
        .toThrow(/disallowed resolution/i);
    });
  });
});
