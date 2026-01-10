#!/usr/bin/env node
/**
 * Smart Dispatch - Change Detection & Build Strategy
 *
 * Analyzes git changes and determines optimal build strategy:
 * - MONOLITH: Rebuild all services (>3 affected or global change)
 * - INDIVIDUAL: Rebuild only affected services (<=3 affected)
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// =============================================================================
// CONFIGURATION
// =============================================================================

const SERVICES = [
  'user-service',
  'promptvault-service',
  'notion-service',
  'whatsapp-service',
  'api-docs-hub',
  'mobile-notifications-service',
  'research-agent',
  'commands-agent',
  'actions-agent',
  'data-insights-service',
  'image-service',
  'notes-agent',
  'todos-agent',
  'bookmarks-agent',
  'app-settings-service',
  'calendar-agent',
  'web-agent',
];

const SPECIAL_TARGETS = ['web', 'firestore'];

const GLOBAL_TRIGGERS = [
  'terraform/',
  'cloudbuild/cloudbuild.yaml',
  'cloudbuild/scripts/',
  'package-lock.json',
  'tsconfig.base.json',
];

const FIRESTORE_TRIGGERS = [
  'migrations/',
  'firestore.rules',
  'firestore.indexes.json',
  'firebase.json',
];

const THRESHOLD = 3;

// =============================================================================
// DEPENDENCY GRAPH
// =============================================================================

function buildDependencyGraph() {
  const graph = {};

  // Initialize all services
  for (const svc of [...SERVICES, 'web']) {
    graph[svc] = {
      selfPaths: [`apps/${svc}/`],
      packageDeps: [],
    };
  }

  // Firestore has special paths
  graph['firestore'] = {
    selfPaths: FIRESTORE_TRIGGERS,
    packageDeps: [],
  };

  // Parse package.json for each service to find package dependencies
  for (const svc of [...SERVICES, 'web']) {
    const pkgPath = join(process.cwd(), 'apps', svc, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        for (const dep of Object.keys(deps)) {
          if (dep.startsWith('@intexuraos/')) {
            const pkgName = dep.replace('@intexuraos/', '');
            graph[svc].packageDeps.push(pkgName);
          }
        }
      } catch (error) {
        console.warn(
          `[smart-dispatch] Failed to parse dependencies for ${svc} at ${pkgPath}: ${error.message}`
        );
      }
    }
  }

  return graph;
}

function buildPackageGraph() {
  const deps = {};
  const packagesDir = join(process.cwd(), 'packages');

  if (!existsSync(packagesDir)) {
    return deps;
  }

  const packages = readdirSync(packagesDir).filter((d) => {
    const fullPath = join(packagesDir, d);
    return statSync(fullPath).isDirectory();
  });

  for (const pkg of packages) {
    const pkgJsonPath = join(packagesDir, pkg, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
        deps[pkg] = [];
        for (const dep of Object.keys(allDeps)) {
          if (dep.startsWith('@intexuraos/')) {
            deps[pkg].push(dep.replace('@intexuraos/', ''));
          }
        }
      } catch (error) {
        console.warn(
          `[smart-dispatch] Failed to parse package ${pkg} at ${pkgJsonPath}: ${error.message}`
        );
        deps[pkg] = [];
      }
    }
  }

  return deps;
}

function expandTransitiveDependents(changedPackages, packageGraph) {
  const reverseDeps = {};
  for (const [pkg, deps] of Object.entries(packageGraph)) {
    for (const dep of deps) {
      if (!reverseDeps[dep]) {
        reverseDeps[dep] = new Set();
      }
      reverseDeps[dep].add(pkg);
    }
  }

  const affected = new Set(changedPackages);
  const queue = [...changedPackages];

  while (queue.length > 0) {
    const pkg = queue.shift();
    const dependents = reverseDeps[pkg] || new Set();
    for (const dependent of dependents) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return affected;
}

// =============================================================================
// CHANGE DETECTION
// =============================================================================

function getChangedFiles(baseSha, headSha) {
  try {
    const output = execSync(`git diff --name-only ${baseSha}...${headSha}`, {
      encoding: 'utf-8',
    });
    return output.split('\n').filter(Boolean);
  } catch (e) {
    console.error(`Failed to get git diff: ${e.message}`);
    // Fallback: compare with parent commit
    try {
      const output = execSync(`git diff --name-only HEAD~1`, {
        encoding: 'utf-8',
      });
      return output.split('\n').filter(Boolean);
    } catch (fallbackError) {
      console.warn(`[smart-dispatch] Fallback git diff also failed: ${fallbackError.message}`);
      return [];
    }
  }
}

function analyzeChanges(changedFiles, graph, packageGraph) {
  const affected = new Map(); // service -> Set of reasons

  const addAffected = (service, reason) => {
    if (!affected.has(service)) {
      affected.set(service, new Set());
    }
    affected.get(service).add(reason);
  };

  // Check for global changes
  const globalChange = changedFiles.some((f) =>
    GLOBAL_TRIGGERS.some((trigger) => f.startsWith(trigger) || f === trigger)
  );

  if (globalChange) {
    const globalReason = 'Global infrastructure/config change';
    for (const svc of [...SERVICES, ...SPECIAL_TARGETS]) {
      addAffected(svc, globalReason);
    }
    return { affected, globalChange: true };
  }

  // Check package changes (direct)
  const changedPackages = new Set();
  for (const file of changedFiles) {
    const match = file.match(/^packages\/([^/]+)\//);
    if (match) {
      changedPackages.add(match[1]);
    }
  }

  // Expand to include transitively affected packages
  const allAffectedPackages = expandTransitiveDependents(changedPackages, packageGraph);

  // Map package changes to dependent services
  for (const [svc, deps] of Object.entries(graph)) {
    for (const pkg of allAffectedPackages) {
      if (deps.packageDeps.includes(pkg)) {
        const isDirect = changedPackages.has(pkg);
        const reason = isDirect
          ? `Dependency @intexuraos/${pkg} updated`
          : `Transitive dependency @intexuraos/${pkg} updated`;
        addAffected(svc, reason);
      }
    }
  }

  // Check direct service changes
  for (const file of changedFiles) {
    // Check apps/<service>/
    const appMatch = file.match(/^apps\/([^/]+)\//);
    if (appMatch) {
      const svc = appMatch[1];
      if (graph[svc]) {
        addAffected(svc, 'Service source modified');
      }
    }

    // Check firestore-specific paths
    for (const trigger of FIRESTORE_TRIGGERS) {
      if (file.startsWith(trigger) || file === trigger.replace('/', '')) {
        addAffected('firestore', `Firestore config changed: ${file}`);
      }
    }
  }

  return { affected, globalChange: false };
}

// =============================================================================
// DECISION ENGINE
// =============================================================================

function decide(affected, globalChange) {
  const count = affected.size;

  if (globalChange || count > THRESHOLD) {
    return {
      strategy: 'MONOLITH',
      reason: globalChange
        ? 'Global infrastructure change detected'
        : `Blast radius (${count}) exceeds threshold (${THRESHOLD})`,
      targets: [],
    };
  }

  if (count === 0) {
    return {
      strategy: 'NONE',
      reason: 'No deployable changes detected',
      targets: [],
    };
  }

  const targets = Array.from(affected.keys());

  return {
    strategy: 'INDIVIDUAL',
    reason: `${count} service(s) affected, under threshold`,
    targets,
  };
}

// =============================================================================
// OUTPUT
// =============================================================================

function printReport(changedFiles, affected, decision) {
  console.log('═'.repeat(70));
  console.log('  SMART DISPATCH - CHANGE ANALYSIS REPORT');
  console.log('═'.repeat(70));
  console.log();

  console.log(`📁 Changed Files: ${changedFiles.length}`);
  if (changedFiles.length <= 20) {
    for (const f of changedFiles) {
      console.log(`   • ${f}`);
    }
  } else {
    for (const f of changedFiles.slice(0, 15)) {
      console.log(`   • ${f}`);
    }
    console.log(`   ... and ${changedFiles.length - 15} more`);
  }
  console.log();

  console.log('─'.repeat(70));
  console.log('  AFFECTED SERVICES');
  console.log('─'.repeat(70));

  if (affected.size === 0) {
    console.log('   (none)');
  } else {
    for (const [svc, reasons] of affected.entries()) {
      console.log(`   🔸 ${svc}`);
      for (const reason of reasons) {
        console.log(`      └─ ${reason}`);
      }
    }
  }
  console.log();

  console.log('─'.repeat(70));
  console.log('  DECISION');
  console.log('─'.repeat(70));
  console.log(`   Strategy: ${decision.strategy}`);
  console.log(`   Reason:   ${decision.reason}`);
  if (decision.targets.length > 0) {
    console.log(`   Targets:  ${decision.targets.join(', ')}`);
  }
  console.log('═'.repeat(70));
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const baseSha = process.env.BASE_SHA || process.env.GITHUB_BASE_REF || 'HEAD~1';
  const headSha = process.env.HEAD_SHA || process.env.GITHUB_SHA || 'HEAD';

  console.log(`Comparing ${baseSha} -> ${headSha}`);
  console.log();

  const graph = buildDependencyGraph();
  const packageGraph = buildPackageGraph();
  const changedFiles = getChangedFiles(baseSha, headSha);
  const { affected, globalChange } = analyzeChanges(changedFiles, graph, packageGraph);
  const decision = decide(affected, globalChange);

  printReport(changedFiles, affected, decision);

  // Set GitHub Actions outputs
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(outputFile, `strategy=${decision.strategy}\n`);
    appendFileSync(outputFile, `targets=${JSON.stringify(decision.targets)}\n`);
    appendFileSync(outputFile, `affected_count=${affected.size}\n`);
  }

  // Exit code: 0 = success, outputs set
  process.exit(0);
}

main().catch((e) => {
  console.error('Smart dispatch failed:', e);
  process.exit(1);
});
