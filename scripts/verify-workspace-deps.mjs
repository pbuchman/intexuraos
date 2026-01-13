#!/usr/bin/env node
/**
 * Workspace Dependencies Verification Script.
 *
 * Ensures all @intexuraos/* imports are declared in package.json.
 * Prevents Docker build failures caused by undeclared workspace dependencies.
 *
 * In a monorepo, ppnpm install at root installs all packages, so local builds work
 * even without explicit dependencies. Docker builds fail because they only
 * see declared dependencies.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');

const errors = [];

/**
 * Find all TypeScript files in a directory recursively.
 */
function findTsFiles(dir, files = []) {
  if (!existsSync(dir)) {
    return files;
  }

  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') {
      continue;
    }

    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      findTsFiles(fullPath, files);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extract @intexuraos/* imports from a TypeScript file.
 * Only matches actual import/export statements, not comments.
 */
function extractWorkspaceImports(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const imports = new Set();

  const lines = content.split('\n');
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('/*')) {
      inBlockComment = true;
    }
    if (trimmed.includes('*/')) {
      inBlockComment = false;
      continue;
    }
    if (inBlockComment || trimmed.startsWith('*') || trimmed.startsWith('//')) {
      continue;
    }

    if (!trimmed.startsWith('import') && !trimmed.startsWith('export')) {
      continue;
    }

    const importPattern = /from\s+['"](@intexuraos\/[^'"\/]+)['"]/;
    const match = importPattern.exec(line);
    if (match !== null && match[1] !== undefined) {
      imports.add(match[1]);
    }
  }

  return imports;
}

/**
 * Get declared dependencies from package.json.
 */
function getDeclaredDependencies(packageJsonPath) {
  if (!existsSync(packageJsonPath)) {
    return new Set();
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const deps = new Set();

  for (const dep of Object.keys(packageJson.dependencies ?? {})) {
    if (dep.startsWith('@intexuraos/')) {
      deps.add(dep);
    }
  }

  for (const dep of Object.keys(packageJson.devDependencies ?? {})) {
    if (dep.startsWith('@intexuraos/')) {
      deps.add(dep);
    }
  }

  return deps;
}

/**
 * Check a workspace (app or package) for undeclared dependencies.
 */
function checkWorkspace(workspacePath, workspaceName) {
  const srcDir = join(workspacePath, 'src');
  const packageJsonPath = join(workspacePath, 'package.json');

  if (!existsSync(srcDir) || !existsSync(packageJsonPath)) {
    return;
  }

  const declaredDeps = getDeclaredDependencies(packageJsonPath);
  const tsFiles = findTsFiles(srcDir);

  const allImports = new Set();
  for (const file of tsFiles) {
    const imports = extractWorkspaceImports(file);
    for (const imp of imports) {
      allImports.add(imp);
    }
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const ownPackageName = packageJson.name;

  for (const imp of allImports) {
    if (imp === ownPackageName) {
      continue;
    }

    if (!declaredDeps.has(imp)) {
      errors.push(`${workspaceName}: imports ${imp} but does not declare it in package.json`);
    }
  }
}

/**
 * Main verification function.
 */
function main() {
  console.log('Verifying workspace dependencies...\n');

  const appsDir = join(repoRoot, 'apps');
  const packagesDir = join(repoRoot, 'packages');

  if (existsSync(appsDir)) {
    for (const app of readdirSync(appsDir)) {
      const appPath = join(appsDir, app);
      if (statSync(appPath).isDirectory()) {
        checkWorkspace(appPath, `apps/${app}`);
      }
    }
  }

  if (existsSync(packagesDir)) {
    for (const pkg of readdirSync(packagesDir)) {
      const pkgPath = join(packagesDir, pkg);
      if (statSync(pkgPath).isDirectory()) {
        checkWorkspace(pkgPath, `packages/${pkg}`);
      }
    }
  }

  if (errors.length > 0) {
    console.log('Errors:');
    for (const error of errors) {
      console.log(`  ❌ ${error}`);
    }
    console.log('');
    console.log(
      `Workspace dependencies verification failed with ${String(errors.length)} error(s).`
    );
    console.log('');
    console.log('Fix: Add missing dependencies to package.json with version "*"');
    process.exit(1);
  }

  console.log('✓ All workspace dependencies are properly declared');
}

main();
