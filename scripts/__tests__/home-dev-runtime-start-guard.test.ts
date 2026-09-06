import { chmodSync, linkSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertHomeDevRuntimeLockSafe,
  assertHomeDevRuntimeStartAllowed,
  parseHomeDevRuntimeMode,
} from '../assert-home-dev-runtime-start.mjs';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function stateBytes(mode: string): string {
  return [
    `MODE=${mode}`,
    `REVISION=${'a'.repeat(40)}`,
    'UPDATED_AT=2026-08-29T12:00:00Z',
    'EVIDENCE_RUN_ID=20260829T120000Z-p111111111111-b222222222222',
    '',
  ].join('\n');
}

function fixture(mode: string): { root: string; stateFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'home-dev-mode-'));
  roots.push(root);
  const stateFile = join(root, 'runtime-mode.env');
  writeFileSync(stateFile, stateBytes(mode), { mode: 0o644 });
  chmodSync(stateFile, 0o644);
  return { root, stateFile };
}

function check(stateFile: string): { enforced: boolean; mode: string | null } {
  return assertHomeDevRuntimeStartAllowed({
    stateFile,
    expectedUid: process.getuid?.() ?? 0,
    expectedGid: process.getgid?.() ?? 0,
  });
}

describe('Home Dev runtime start guard', () => {
  it('accepts only an empty, singly linked, owner-controlled 0644 lock file', () => {
    const root = mkdtempSync(join(tmpdir(), 'home-dev-lock-'));
    roots.push(root);
    const lockFile = join(root, 'runtime-start.lock');
    writeFileSync(lockFile, '', { mode: 0o644 });
    const ownership = {
      lockFile,
      expectedUid: process.getuid?.() ?? 0,
      expectedGid: process.getgid?.() ?? 0,
    };
    expect(() => assertHomeDevRuntimeLockSafe(ownership)).not.toThrow();

    writeFileSync(lockFile, 'not-empty', { mode: 0o644 });
    expect(() => assertHomeDevRuntimeLockSafe(ownership)).toThrow('unsafe runtime lock metadata');
    writeFileSync(lockFile, '', { mode: 0o644 });
    chmodSync(lockFile, 0o666);
    expect(() => assertHomeDevRuntimeLockSafe(ownership)).toThrow('unsafe runtime lock metadata');
    chmodSync(lockFile, 0o644);
    linkSync(lockFile, join(root, 'second-lock-link'));
    expect(() => assertHomeDevRuntimeLockSafe(ownership)).toThrow('unsafe runtime lock metadata');
  });

  it('rejects missing and symlinked lock paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'home-dev-lock-unsafe-'));
    roots.push(root);
    const missing = join(root, 'missing');
    const target = join(root, 'target');
    const link = join(root, 'link');
    writeFileSync(target, '', { mode: 0o644 });
    symlinkSync(target, link);
    const expectedUid = process.getuid?.() ?? 0;
    const expectedGid = process.getgid?.() ?? 0;
    expect(() =>
      assertHomeDevRuntimeLockSafe({ lockFile: missing, expectedUid, expectedGid })
    ).toThrow('runtime lock cannot be inspected');
    expect(() =>
      assertHomeDevRuntimeLockSafe({ lockFile: link, expectedUid, expectedGid })
    ).toThrow('unsafe runtime lock metadata');
  });

  it('does not affect machines without a Home Dev mode record', () => {
    const root = mkdtempSync(join(tmpdir(), 'home-dev-mode-absent-'));
    roots.push(root);
    expect(check(join(root, 'missing'))).toEqual({ enforced: false, mode: null });
  });

  it.each(['active-pre-cutover', 'active-post-cutover'])('permits %s', (mode) => {
    const { stateFile } = fixture(mode);
    expect(check(stateFile)).toEqual({ enforced: true, mode });
  });

  it.each(['draining', 'hibernated', 'resuming', 'recovery-required'])(
    'denies %s before starting a process',
    (mode) => {
      const { stateFile } = fixture(mode);
      expect(() => check(stateFile)).toThrow(`MODE=${mode}`);
    }
  );

  it('rejects malformed, writable, linked, and symlinked records', () => {
    const malformed = fixture('hibernated');
    writeFileSync(malformed.stateFile, 'MODE=hibernated\n', { mode: 0o644 });
    expect(() => check(malformed.stateFile)).toThrow('malformed mode record');

    const writable = fixture('active-post-cutover');
    chmodSync(writable.stateFile, 0o666);
    expect(() => check(writable.stateFile)).toThrow('unsafe mode record metadata');

    const linked = fixture('active-post-cutover');
    linkSync(linked.stateFile, join(linked.root, 'second-link'));
    expect(() => check(linked.stateFile)).toThrow('unsafe mode record metadata');

    const symlinked = fixture('active-post-cutover');
    const link = join(symlinked.root, 'mode-link');
    symlinkSync(symlinked.stateFile, link);
    expect(() => check(link)).toThrow('unsafe mode record metadata');
  });

  it('parses only the exact four-field record', () => {
    expect(parseHomeDevRuntimeMode(stateBytes('hibernated'))).toBe('hibernated');
    expect(() => parseHomeDevRuntimeMode(`${stateBytes('hibernated')}EXTRA=value\n`)).toThrow(
      'malformed mode record'
    );
  });
});
