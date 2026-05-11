import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function findServiceClientFiles(): string[] {
  return readdirSync(srcDir)
    .filter((entry) => entry !== 'shared')
    .map((entry) => join(srcDir, entry, 'client.ts'))
    .filter((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    });
}

describe('internal client facade composition', () => {
  it('keeps service facades on createInternalHttpClient instead of raw transport', () => {
    const offenders = findServiceClientFiles().filter((path) => {
      const source = readFileSync(path, 'utf8');
      return source.includes("from '../shared/request.js'");
    });

    expect(offenders.map((path) => path.replace(`${srcDir}/`, ''))).toEqual([]);
  });
});
