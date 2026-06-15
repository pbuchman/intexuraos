import { describe, expect, it } from 'vitest';
import type { Stats } from 'node:fs';
import { listPackageDirs } from '../lib/package-export-utils.mjs';

function makeDirectoryStats(): Stats {
  return {
    isDirectory: () => true,
  } as Stats;
}

function makeFileStats(): Stats {
  return {
    isDirectory: () => false,
  } as Stats;
}

describe('listPackageDirs', () => {
  it('returns only directories that contain package.json', () => {
    const result = listPackageDirs('/repo/packages', {
      readdirSync: () => ['good-package', 'missing-package-json', 'README.md'],
      statSync: (path) => {
        if (path.endsWith('README.md')) {
          return makeFileStats();
        }
        return makeDirectoryStats();
      },
      existsSync: (path) => path.endsWith('good-package/package.json'),
    });

    expect(result).toEqual(['good-package']);
  });

  it('skips package entries that disappear between readdir and stat', () => {
    const result = listPackageDirs('/repo/packages', {
      readdirSync: () => ['stable-package', 'orphan'],
      statSync: (path) => {
        if (path.endsWith('/orphan')) {
          const error = new Error('missing') as NodeJS.ErrnoException;
          error.code = 'ENOENT';
          throw error;
        }
        return makeDirectoryStats();
      },
      existsSync: () => true,
    });

    expect(result).toEqual(['stable-package']);
  });
});
