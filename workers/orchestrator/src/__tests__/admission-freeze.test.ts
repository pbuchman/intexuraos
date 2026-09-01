import { describe, expect, it, vi } from 'vitest';
import {
  ORCHESTRATOR_ADMISSION_FREEZE_PARENT,
  ORCHESTRATOR_ADMISSION_FREEZE_PATH,
  isOrchestratorAdmissionFrozen,
  type AdmissionFreezeStat,
} from '../admission-freeze.js';

function directoryStat(
  input: {
    uid?: number;
    gid?: number;
    mode?: number;
    nlink?: number;
  } = {}
): AdmissionFreezeStat {
  return {
    uid: input.uid ?? 0,
    gid: input.gid ?? 0,
    mode: input.mode ?? 0o40700,
    nlink: input.nlink ?? 2,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  };
}

describe('orchestrator admission freeze marker', () => {
  it('reports unfrozen only when the root-owned /var/lib parent is safe and the marker is absent', () => {
    const lstat = vi.fn((path: string) => {
      if (path === ORCHESTRATOR_ADMISSION_FREEZE_PARENT) {
        return directoryStat({ mode: 0o40755 });
      }
      expect(path).toBe(ORCHESTRATOR_ADMISSION_FREEZE_PATH);
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });

    expect(isOrchestratorAdmissionFrozen({ lstat })).toBe(false);
  });

  it('recognizes the exact root-owned mode-0700 single directory marker', () => {
    const lstat = vi.fn((path: string) =>
      path === ORCHESTRATOR_ADMISSION_FREEZE_PARENT
        ? directoryStat({ mode: 0o40755 })
        : directoryStat()
    );

    expect(isOrchestratorAdmissionFrozen({ lstat })).toBe(true);
  });

  it.each([
    ['wrong owner', directoryStat({ uid: 1000 })],
    ['wrong group', directoryStat({ gid: 1000 })],
    ['writable mode', directoryStat({ mode: 0o40777 })],
    ['unexpected links', directoryStat({ nlink: 3 })],
    [
      'symlink',
      {
        ...directoryStat(),
        isDirectory: (): boolean => false,
        isSymbolicLink: (): boolean => true,
      },
    ],
  ])('fails closed for a %s marker', (_label, marker) => {
    const lstat = vi.fn((path: string) =>
      path === ORCHESTRATOR_ADMISSION_FREEZE_PARENT ? directoryStat({ mode: 0o40755 }) : marker
    );

    expect(isOrchestratorAdmissionFrozen({ lstat })).toBe(true);
  });

  it('fails closed when the parent is unsafe even if the marker would be absent', () => {
    const lstat = vi.fn((path: string) => {
      if (path === ORCHESTRATOR_ADMISSION_FREEZE_PARENT) {
        return directoryStat({ uid: 1000, mode: 0o40777 });
      }
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });

    expect(isOrchestratorAdmissionFrozen({ lstat })).toBe(true);
    expect(lstat).toHaveBeenCalledTimes(1);
  });

  it('fails closed when parent or marker inspection is unknown', () => {
    expect(
      isOrchestratorAdmissionFrozen({
        lstat: () => {
          throw Object.assign(new Error('denied'), { code: 'EACCES' });
        },
      })
    ).toBe(true);
    expect(
      isOrchestratorAdmissionFrozen({
        lstat: (path) => {
          if (path === ORCHESTRATOR_ADMISSION_FREEZE_PARENT) {
            return directoryStat({ mode: 0o40755 });
          }
          throw Object.assign(new Error('denied'), { code: 'EACCES' });
        },
      })
    ).toBe(true);
  });
});
