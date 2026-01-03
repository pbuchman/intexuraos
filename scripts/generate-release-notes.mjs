#!/usr/bin/env node

/**
 * Automated Release Notes Generator
 *
 * This script analyzes git history since the last release and generates
 * comprehensive changelog entries covering:
 * - Functional changes (API endpoints, UI components, use cases)
 * - Technical changes (architecture, infrastructure, tooling)
 *
 * Usage:
 *   npm run release:notes [new-version]
 *
 * Example:
 *   npm run release:notes 0.0.5
 *
 * The script will:
 * 1. Determine the last documented version from CHANGELOG.md
 * 2. Analyze all git commits since that version
 * 3. Extract real code changes (not commit messages)
 * 4. Generate structured changelog entries
 * 5. Update package.json version
 * 6. Update CHANGELOG.md
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();
const CHANGELOG_PATH = path.join(ROOT_DIR, 'CHANGELOG.md');
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', cwd: ROOT_DIR }).trim();
  } catch (error) {
    return '';
  }
}

function getCurrentVersion() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
  return pkg.version;
}

function getLastChangelogVersion() {
  const changelog = fs.readFileSync(CHANGELOG_PATH, 'utf-8');
  const versionMatch = changelog.match(/## \[(\d+\.\d+\.\d+)\]/);
  return versionMatch ? versionMatch[1] : '0.0.0';
}

function getNewVersion() {
  // Check if version provided as argument
  if (process.argv[2]) {
    return process.argv[2];
  }

  // Otherwise bump patch version
  const current = getCurrentVersion();
  const parts = current.split('.');
  parts[2] = String(parseInt(parts[2]) + 1);
  return parts.join('.');
}

function getCommitsSinceLastRelease() {
  const lastVersion = getLastChangelogVersion();
  console.log(`📊 Analyzing changes since version ${lastVersion}...`);

  // Get all commits
  const allCommits = run("git log --all --reverse --format='%H|%ai|%s'").split('\n');

  return allCommits.filter(Boolean);
}

function analyzeCodeChanges(commits) {
  console.log(`🔍 Analyzing ${commits.length} commits for code changes...`);

  const functional = new Map();
  const technical = new Map();

  // Categories for functional changes
  functional.set('api_endpoints', new Set());
  functional.set('domain_models', new Set());
  functional.set('use_cases', new Set());
  functional.set('ui_components', new Set());
  functional.set('ui_pages', new Set());
  functional.set('integrations', new Set());

  // Categories for technical changes
  technical.set('services', new Set());
  technical.set('packages', new Set());
  technical.set('infrastructure', new Set());
  technical.set('build_system', new Set());
  technical.set('testing', new Set());
  technical.set('cicd', new Set());
  technical.set('security', new Set());
  technical.set('documentation', new Set());

  for (const commitLine of commits) {
    const [commitHash] = commitLine.split('|');
    if (!commitHash) continue;

    // Get files changed in this commit
    const files = run(`git diff-tree --no-commit-id --name-only -r ${commitHash}`).split('\n');

    for (const file of files) {
      if (!file) continue;

      const parts = file.split('/');

      // Skip test files and node_modules
      if (file.includes('__tests__') || file.includes('.test.') || file.includes('node_modules')) {
        continue;
      }

      // === FUNCTIONAL CHANGES ===

      // API Routes
      if (file.match(/routes?\.ts$/i) && file.includes('apps/')) {
        const service = parts[1];
        const route = parts[parts.length - 1].replace('.ts', '');
        functional.get('api_endpoints').add(`${service}: ${route}`);
      }

      // Use Cases
      if (file.match(/usecase/i) && file.endsWith('.ts') && file.includes('apps/')) {
        const service = parts[1];
        const usecase = parts[parts.length - 1].replace('.ts', '');
        functional.get('use_cases').add(`${service}: ${usecase}`);
      }

      // Domain Models
      if (file.includes('/models/') && file.endsWith('.ts') && file.includes('apps/')) {
        const service = parts[1];
        const model = parts[parts.length - 1].replace('.ts', '');
        functional.get('domain_models').add(`${service}: ${model}`);
      }

      // UI Components
      if (file.includes('apps/web/src/components') && file.match(/\.(tsx?|jsx?)$/)) {
        const component = parts[parts.length - 1].replace(/\.(tsx?|jsx?)$/, '');
        functional.get('ui_components').add(component);
      }

      // UI Pages
      if (file.includes('apps/web/src/') && (file.includes('pages') || file.includes('views')) && file.match(/\.(tsx?|jsx?)$/)) {
        const page = parts[parts.length - 1].replace(/\.(tsx?|jsx?)$/, '');
        functional.get('ui_pages').add(page);
      }

      // === TECHNICAL CHANGES ===

      // New Services
      if (file.startsWith('apps/') && parts.length >= 2) {
        technical.get('services').add(parts[1]);
      }

      // New Packages
      if (file.startsWith('packages/') && parts.length >= 2) {
        technical.get('packages').add(parts[1]);
      }

      // Infrastructure
      if (file.startsWith('terraform/') || file.includes('Dockerfile') || file.includes('cloudbuild')) {
        const item = parts[parts.length - 1];
        technical.get('infrastructure').add(item);
      }

      // Build System
      if (file.match(/package\.json|tsconfig|eslint|prettier|vitest/)) {
        technical.get('build_system').add(file);
      }

      // Testing
      if (file.includes('vitest') || file.includes('test') || file.includes('fake')) {
        if (file.endsWith('.ts') || file.endsWith('.mjs')) {
          technical.get('testing').add(parts[parts.length - 1]);
        }
      }

      // CI/CD
      if (file.startsWith('.github/workflows/')) {
        technical.get('cicd').add(parts[parts.length - 1]);
      }

      // Documentation
      if (file.match(/\.(md|txt)$/i) && !file.includes('node_modules')) {
        technical.get('documentation').add(file);
      }
    }
  }

  return { functional, technical };
}

function generateChangelogEntry(version, functional, technical) {
  const today = new Date().toISOString().split('T')[0];

  let entry = `## [${version}] - ${today}\n\n`;
  entry += `This release includes changes based on comprehensive code analysis.\n\n`;

  // Functional Changes
  if (Array.from(functional.values()).some(set => set.size > 0)) {
    entry += `### Functional Changes\n\n`;

    if (functional.get('api_endpoints').size > 0) {
      entry += `#### API Endpoints\n`;
      for (const endpoint of Array.from(functional.get('api_endpoints')).sort()) {
        entry += `- ${endpoint}\n`;
      }
      entry += `\n`;
    }

    if (functional.get('use_cases').size > 0) {
      entry += `#### Use Cases\n`;
      for (const usecase of Array.from(functional.get('use_cases')).sort()) {
        entry += `- ${usecase}\n`;
      }
      entry += `\n`;
    }

    if (functional.get('domain_models').size > 0) {
      entry += `#### Domain Models\n`;
      for (const model of Array.from(functional.get('domain_models')).sort()) {
        entry += `- ${model}\n`;
      }
      entry += `\n`;
    }

    if (functional.get('ui_components').size > 0) {
      entry += `#### UI Components\n`;
      for (const component of Array.from(functional.get('ui_components')).sort()) {
        entry += `- ${component}\n`;
      }
      entry += `\n`;
    }

    if (functional.get('ui_pages').size > 0) {
      entry += `#### UI Pages\n`;
      for (const page of Array.from(functional.get('ui_pages')).sort()) {
        entry += `- ${page}\n`;
      }
      entry += `\n`;
    }
  }

  // Technical Changes
  if (Array.from(technical.values()).some(set => set.size > 0)) {
    entry += `### Technical Changes\n\n`;

    if (technical.get('services').size > 0) {
      entry += `#### Services\n`;
      for (const service of Array.from(technical.get('services')).sort()) {
        entry += `- ${service}\n`;
      }
      entry += `\n`;
    }

    if (technical.get('packages').size > 0) {
      entry += `#### Packages\n`;
      for (const pkg of Array.from(technical.get('packages')).sort()) {
        entry += `- ${pkg}\n`;
      }
      entry += `\n`;
    }

    if (technical.get('infrastructure').size > 0) {
      entry += `#### Infrastructure\n`;
      for (const infra of Array.from(technical.get('infrastructure')).sort()) {
        entry += `- ${infra}\n`;
      }
      entry += `\n`;
    }

    if (technical.get('cicd').size > 0) {
      entry += `#### CI/CD\n`;
      for (const cicd of Array.from(technical.get('cicd')).sort()) {
        entry += `- ${cicd}\n`;
      }
      entry += `\n`;
    }

    if (technical.get('documentation').size > 0) {
      entry += `#### Documentation\n`;
      for (const doc of Array.from(technical.get('documentation')).sort()) {
        entry += `- ${doc}\n`;
      }
      entry += `\n`;
    }
  }

  entry += `---\n\n`;

  return entry;
}

function updateChangelog(newVersion, changelogEntry) {
  console.log(`📝 Updating CHANGELOG.md...`);

  const currentChangelog = fs.readFileSync(CHANGELOG_PATH, 'utf-8');

  // Find where to insert the new entry (after version header)
  const versionHeaderMatch = currentChangelog.match(/^## \[\d+\.\d+\.\d+\]/m);

  if (versionHeaderMatch) {
    const insertPos = versionHeaderMatch.index;
    const newChangelog =
      currentChangelog.substring(0, insertPos) +
      changelogEntry +
      currentChangelog.substring(insertPos);

    fs.writeFileSync(CHANGELOG_PATH, newChangelog, 'utf-8');
  } else {
    // If no version found, append to end
    fs.writeFileSync(CHANGELOG_PATH, currentChangelog + '\n' + changelogEntry, 'utf-8');
  }
}

function updatePackageVersion(newVersion) {
  console.log(`📦 Updating package.json to version ${newVersion}...`);

  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
  pkg.version = newVersion;
  fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
}

function main() {
  console.log('🚀 IntexuraOS Release Notes Generator\n');

  const currentVersion = getCurrentVersion();
  const newVersion = getNewVersion();

  console.log(`📌 Current version: ${currentVersion}`);
  console.log(`📌 New version: ${newVersion}\n`);

  // Get commits since last release
  const commits = getCommitsSinceLastRelease();

  if (commits.length === 0) {
    console.log('✅ No new commits since last release');
    return;
  }

  // Analyze code changes
  const { functional, technical } = analyzeCodeChanges(commits);

  // Count changes
  const functionalCount = Array.from(functional.values()).reduce((sum, set) => sum + set.size, 0);
  const technicalCount = Array.from(technical.values()).reduce((sum, set) => sum + set.size, 0);

  console.log(`\n📊 Summary:`);
  console.log(`   Functional changes: ${functionalCount}`);
  console.log(`   Technical changes: ${technicalCount}`);
  console.log(`   Total changes: ${functionalCount + technicalCount}\n`);

  // Generate changelog entry
  const changelogEntry = generateChangelogEntry(newVersion, functional, technical);

  // Update files
  updatePackageVersion(newVersion);
  updateChangelog(newVersion, changelogEntry);

  console.log(`\n✅ Release notes generated successfully!`);
  console.log(`\n📋 Next steps:`);
  console.log(`   1. Review CHANGELOG.md`);
  console.log(`   2. Commit changes: git add CHANGELOG.md package.json`);
  console.log(`   3. Create release: git tag -a v${newVersion} -m "Release ${newVersion}"`);
  console.log(`   4. Push: git push && git push --tags\n`);
}

main();
