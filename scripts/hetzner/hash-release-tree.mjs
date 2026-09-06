#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, relative, resolve } from 'node:path';

const RUNTIME_DIRECTORIES = new Set(['.terraform', 'coverage', 'dist', 'node_modules']);

export function hashReleaseTree(root) {
  if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('RELEASE_TREE_PATH_INVALID');
  const entries = walk(root).sort((left, right) => left.localeCompare(right));
  const digest = createHash('sha256');
  for (const path of entries) {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    const mode = (stat.mode & 0o777).toString(8).padStart(3, '0');
    if (stat.isFile()) {
      const contentHash = createHash('sha256').update(readFileSync(absolute)).digest('hex');
      digest.update(`file\0${mode}\0${path}\0${contentHash}\0`, 'utf8');
    } else if (stat.isSymbolicLink()) {
      digest.update(`link\0${mode}\0${path}\0${readlinkSync(absolute)}\0`, 'utf8');
    } else {
      throw new Error('RELEASE_TREE_ENTRY_INVALID');
    }
  }
  return digest.digest('hex');
}

function walk(root, directory = root) {
  const result = [];
  for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
    if (RUNTIME_DIRECTORIES.has(name)) continue;
    const absolute = join(directory, name);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) result.push(...walk(root, absolute));
    else result.push(relative(root, absolute));
  }
  return result;
}

const entryPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (entryPath !== null && entryPath === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (root === undefined) throw new Error('Usage: hash-release-tree.mjs <absolute-release-dir>');
  process.stdout.write(`${hashReleaseTree(resolve(root))}\n`);
}
