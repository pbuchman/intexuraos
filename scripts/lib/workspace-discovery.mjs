import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function isWorkspaceDirectory(directoryPath) {
  return (
    existsSync(directoryPath) &&
    statSync(directoryPath).isDirectory() &&
    existsSync(resolve(directoryPath, 'package.json'))
  );
}

export function discoverWorkspaceDirectories(rootDirectory, workspacePatterns) {
  const directories = [];

  for (const pattern of workspacePatterns) {
    if (pattern.endsWith('/*')) {
      const basePath = resolve(rootDirectory, pattern.slice(0, -2));
      if (!existsSync(basePath)) continue;

      const entries = readdirSync(basePath, { withFileTypes: true }).sort((left, right) =>
        left.name.localeCompare(right.name)
      );
      for (const entry of entries) {
        const directoryPath = resolve(basePath, entry.name);
        if (entry.isDirectory() && isWorkspaceDirectory(directoryPath))
          directories.push(directoryPath);
      }
      continue;
    }

    const directoryPath = resolve(rootDirectory, pattern);
    if (isWorkspaceDirectory(directoryPath)) directories.push(directoryPath);
  }

  return directories;
}

export function discoverWorkspaceNames(rootDirectory, workspacePatterns, requiredScript) {
  const names = [];
  for (const directoryPath of discoverWorkspaceDirectories(rootDirectory, workspacePatterns)) {
    const packageJson = JSON.parse(readFileSync(resolve(directoryPath, 'package.json'), 'utf8'));
    if (typeof packageJson.name === 'string' && packageJson.scripts?.[requiredScript]) {
      names.push(packageJson.name);
    }
  }
  return names;
}
