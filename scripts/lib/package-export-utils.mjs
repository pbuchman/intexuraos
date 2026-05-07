import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function listPackageDirs(
  packagesRoot,
  fsOps = {
    readdirSync,
    statSync,
    existsSync,
  }
) {
  return fsOps
    .readdirSync(packagesRoot)
    .filter((name) => {
      const full = join(packagesRoot, name);
      try {
        if (!fsOps.statSync(full).isDirectory()) return false;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return false;
        }
        throw error;
      }
      return fsOps.existsSync(join(full, 'package.json'));
    })
    .sort();
}
