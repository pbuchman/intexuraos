#!/usr/bin/env node
/**
 * Generate `packages/README.md` from filesystem truth.
 *
 * Scans `packages/<name>/package.json`, groups packages into the established
 * categories (Common+HTTP, Infrastructure, LLM, Integration), and writes a
 * deterministic markdown file. Re-running with no fs changes is a no-op.
 *
 * Single source of truth for the package roster. Run after adding/removing a
 * workspace package. Output is what `verify-package-exports` expects to find.
 */

import { readFileSync, readdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const packagesRoot = join(repoRoot, 'packages');
const outputPath = join(packagesRoot, 'README.md');

// Category assignment is structural (matches docs/architecture/package-contracts.md).
const CATEGORIES = {
  'common-core': 'common-http',
  'common-http': 'common-http',
  'common-metrics': 'common-http',
  'common-worker': 'common-http',
  'http-contracts': 'common-http',
  'http-server': 'common-http',
  'code-task-domain': 'integration',
  'infra-claude': 'infrastructure',
  'infra-firestore': 'infrastructure',
  'infra-gemini': 'infrastructure',
  'infra-gpt': 'infrastructure',
  'infra-notion': 'infrastructure',
  'infra-openrouter': 'infrastructure',
  'infra-perplexity': 'infrastructure',
  'infra-pdf-export': 'infrastructure',
  'infra-pubsub': 'infrastructure',
  'infra-sentry': 'infrastructure',
  'infra-whatsapp': 'infrastructure',
  'linear-domain': 'integration',
  'llm-contract': 'llm',
  'llm-factory': 'llm',
  'llm-pricing': 'llm',
  'llm-prompts': 'llm',
  'llm-utils': 'llm',
  'internal-clients': 'integration',
  'pr-triage-pubsub-client': 'integration',
  'service-catalog': 'integration',
  'whatsapp-pubsub-client': 'integration',
};

// Short descriptions used in the dependency-graph block and the section tables.
const DESCRIPTIONS = {
  'common-core': 'Result types, errors, redaction',
  'common-http': 'Fastify plugins, auth, response utilities',
  'common-metrics': 'Cloud Monitoring metric writer helpers',
  'common-worker': 'Shared worker bootstrap utilities',
  'http-contracts': 'OpenAPI & Fastify JSON schemas',
  'http-server': 'Health checks, validation handler',
  'code-task-domain': 'Shared code task domain contracts',
  'infra-claude': 'Anthropic Claude API client',
  'infra-firestore': 'Firestore singleton & fake',
  'infra-gemini': 'Google Gemini API client',
  'infra-gpt': 'OpenAI GPT API client',
  'infra-notion': 'Notion client & connection repository',
  'infra-openrouter': 'OpenAI-compatible client for the OpenRouter aggregator',
  'infra-perplexity': 'Perplexity AI API client',
  'infra-pdf-export': 'PDF conversation export renderer',
  'infra-pubsub': 'Cloud Pub/Sub publishers',
  'infra-sentry': 'Sentry error tracking & logger factory',
  'infra-whatsapp': 'WhatsApp Cloud API client',
  'internal-clients': 'HTTP clients for internal services',
  'linear-domain': 'Shared Linear domain contracts',
  'llm-contract': 'Shared LLM types, model names, interfaces',
  'llm-factory': 'Unified LLM client factory',
  'llm-pricing': 'LLM pricing fetch, cost tracking',
  'llm-prompts': 'Centralized LLM prompt builders',
  'llm-utils': 'Redaction utilities, LLM parse error helpers',
  'pr-triage-pubsub-client': 'PR triage Pub/Sub message client',
  'service-catalog': 'Service registry metadata',
  'whatsapp-pubsub-client': 'WhatsApp Pub/Sub message client',
};

function readPackages() {
  return readdirSync(packagesRoot)
    .filter((name) => {
      const full = join(packagesRoot, name);
      if (!statSync(full).isDirectory()) return false;
      return existsSync(join(full, 'package.json'));
    })
    .sort()
    .map((name) => {
      const pkg = JSON.parse(readFileSync(join(packagesRoot, name, 'package.json'), 'utf8'));
      const intexDeps = Object.keys(pkg.dependencies ?? {})
        .filter((d) => d.startsWith('@intexuraos/'))
        .map((d) => d.replace('@intexuraos/', ''))
        .sort();
      return {
        dir: name,
        name: pkg.name,
        deps: intexDeps,
      };
    });
}

function pad(s, len) {
  return s + ' '.repeat(Math.max(0, len - s.length));
}

function depsCell(deps) {
  return deps.length === 0 ? 'None (leaf)' : deps.map((d) => `\`${d}\``).join(', ');
}

function buildTable(rows) {
  // rows: [{ pkg, desc, deps }]
  const cols = [
    rows.map((r) => `[\`${r.pkg}\`](../docs/packages/${r.pkg}/README.md)`),
    rows.map((r) => r.desc),
    rows.map((r) => r.deps),
  ];
  const headers = ['Package', 'Description', 'Dependencies'];
  const widths = cols.map((col, i) => Math.max(headers[i].length, ...col.map((c) => c.length)));

  const headerLine = `| ${headers.map((h, i) => pad(h, widths[i])).join(' | ')} |`;
  const sepLine = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
  const dataLines = rows.map(
    (_, ri) => `| ${cols.map((col, ci) => pad(col[ri], widths[ci])).join(' | ')} |`
  );

  return [headerLine, sepLine, ...dataLines].join('\n');
}

function buildGraph(packages) {
  // Sort by name for stable output, longest description column padded.
  const lines = packages.map((p) => {
    const pkgLabel = `@intexuraos/${p.dir}`;
    return { pkgLabel, desc: DESCRIPTIONS[p.dir] ?? '' };
  });
  const maxLabel = Math.max(...lines.map((l) => l.pkgLabel.length));
  const out = lines.map((l, i) => {
    const prefix = i === lines.length - 1 ? '  └──' : '  ├──';
    return `${prefix} ${pad(l.pkgLabel, maxLabel)}  (${l.desc})`;
  });
  return ['apps/*', ...out].join('\n');
}

function main() {
  const packages = readPackages();
  const fsDirs = new Set(packages.map((p) => p.dir));

  // Symmetric: filesystem ⊇ constants. Catches dead constants left behind when a
  // package is removed from disk — they would silently produce a correct README
  // but leave drifted config behind.
  const orphanedKeys = Object.keys(CATEGORIES).filter((k) => !fsDirs.has(k));
  if (orphanedKeys.length > 0) {
    console.error(
      `CATEGORIES has entries with no matching packages/<dir>: ${orphanedKeys.join(', ')}. ` +
        'Remove them.'
    );
    process.exit(1);
  }
  const orphanedDescriptions = Object.keys(DESCRIPTIONS).filter((k) => !fsDirs.has(k));
  if (orphanedDescriptions.length > 0) {
    console.error(
      `DESCRIPTIONS has entries with no matching packages/<dir>: ${orphanedDescriptions.join(', ')}. ` +
        'Remove them.'
    );
    process.exit(1);
  }

  const byCategory = {
    'common-http': [],
    infrastructure: [],
    llm: [],
    integration: [],
  };
  for (const p of packages) {
    const cat = CATEGORIES[p.dir];
    if (!cat) {
      console.error(`Unknown category for package: ${p.dir}. Update CATEGORIES.`);
      process.exit(1);
    }
    if (!DESCRIPTIONS[p.dir]) {
      console.error(`Missing description for package: ${p.dir}. Update DESCRIPTIONS.`);
      process.exit(1);
    }
    byCategory[cat].push(p);
  }

  const toRows = (pkgs) =>
    pkgs.map((p) => ({
      pkg: p.dir,
      desc: DESCRIPTIONS[p.dir],
      deps: depsCell(p.deps),
    }));

  const importRules = packages
    .map((p) => {
      const lhs = p.dir;
      const rhs =
        p.deps.length === 0
          ? 'imports nothing'
          : `imports from ${p.deps.map((d) => `\`${d}\``).join(', ')}`;
      return `- \`${lhs}\` → ${rhs}`;
    })
    .join('\n');

  const md = `# Packages

Shared libraries organized by layer. **Source of truth:** this file is regenerated by \`node scripts/generate-packages-readme.mjs\` from \`packages/*/package.json\`. Do not hand-edit — re-run the generator.

## Package Dependency Graph

\`\`\`
${buildGraph(packages)}
\`\`\`

## Package Structure

### Common + HTTP

${buildTable(toRows(byCategory['common-http']))}

### Infrastructure

${buildTable(toRows(byCategory.infrastructure))}

### LLM

${buildTable(toRows(byCategory.llm))}

### Integration

${buildTable(toRows(byCategory.integration))}

## Build Output

All packages export from \`./src/*.ts\` (source-exports default). No package emits runtime \`dist/\` artifacts. See [\`docs/architecture/package-build-output.md\`](../docs/architecture/package-build-output.md). Enforced by \`pnpm run verify:package-exports\`.

## Testing

All packages have tests in \`src/__tests__/\` subdirectories using Vitest.

\`\`\`bash
# Run all package tests
pnpm run test -- packages

# Run tests for specific package
pnpm run test -- packages/common-core

# Run tests with coverage
pnpm run test:coverage
\`\`\`

### Test Patterns

- **Unit tests**: Pure functions (Result utilities, error mapping, redaction)
- **Integration tests**: Fastify plugin behavior via \`app.inject()\`
- **Fake implementations**: In-memory Firestore fake for testing adapters

### Coverage Requirements

All packages are subject to the repo-wide coverage thresholds defined in \`vitest.config.ts\`:

- Lines: 95%
- Branches: 95%
- Functions: 95%
- Statements: 95%

## Import Rules

Enforced by \`pnpm run verify:boundaries\`:

${importRules}
- \`apps/*\` → imports from any package, but NOT from other apps

See [docs](../docs/README.md) for full architecture details.
`;

  writeFileSync(outputPath, md);
  console.log(`✓ Wrote ${outputPath} (${packages.length} packages)`);
}

main();
