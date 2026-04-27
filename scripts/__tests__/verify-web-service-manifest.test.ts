/**
 * Tests for the web service manifest single-source-of-truth contract.
 *
 * The manifest at apps/web/service-manifest.json drives CLOUD_RUN_SERVICES
 * for the cloud-build web deploy. These tests pin the contract: the manifest
 * must exist, be well-shaped, agree with terraform module declarations, and
 * the duplicated CLOUD_RUN_SERVICES=( ... ) literal array must be gone from
 * apps/web/cloudbuild.yaml.
 *
 * NOTE: A second pair of literal arrays still lives in
 * `.github/workflows/deploy.yml`. Replacing them is part of the same
 * refactor, but the code-worker GitHub App lacks `workflows` permission and
 * cannot push edits to workflow files. The deploy.yml migration must land in
 * a separate human-authored PR. When it does, restore the deploy.yml
 * assertion below (currently disabled) and the matching check in
 * `scripts/verify-web-service-manifest.mjs`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');

const manifestPath = resolve(repoRoot, 'apps/web/service-manifest.json');
const cloudbuildPath = resolve(repoRoot, 'apps/web/cloudbuild.yaml');
const terraformMainPath = resolve(repoRoot, 'terraform/environments/dev/main.tf');

const NAME_REGEX = /^[a-z][a-z0-9-]+$/;
const ENV_SUFFIX_REGEX = /^[A-Z][A-Z0-9_]+$/;

describe('apps/web/service-manifest.json', () => {
  it('exists and parses as JSON', () => {
    expect(existsSync(manifestPath)).toBe(true);
    const raw = readFileSync(manifestPath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('has at least 20 service entries', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(Array.isArray(manifest.services)).toBe(true);
    expect(manifest.services.length).toBeGreaterThanOrEqual(20);
  });

  it('each entry has valid name and envSuffix strings', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const entry of manifest.services) {
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.name).toMatch(NAME_REGEX);
      expect(typeof entry.envSuffix).toBe('string');
      expect(entry.envSuffix.length).toBeGreaterThan(0);
      expect(entry.envSuffix).toMatch(ENV_SUFFIX_REGEX);
    }
  });

  it('every manifest entry has a corresponding terraform module', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const tf = readFileSync(terraformMainPath, 'utf8');
    for (const entry of manifest.services) {
      const moduleName = entry.name.replace(/-/g, '_');
      const moduleRegex = new RegExp(`module\\s+"${moduleName}"\\s+\\{`);
      expect(
        moduleRegex.test(tf),
        `Expected terraform module "${moduleName}" for manifest service "${entry.name}"`
      ).toBe(true);
    }
  });
});

describe('CLOUD_RUN_SERVICES literal arrays are eliminated', () => {
  it('apps/web/cloudbuild.yaml does not contain a CLOUD_RUN_SERVICES=( literal', () => {
    const content = readFileSync(cloudbuildPath, 'utf8');
    expect(content).not.toContain('CLOUD_RUN_SERVICES=(');
  });

  // NOTE: deploy.yml still contains the literal arrays — see file header for
  // the workflows-permission constraint. Re-enable this assertion once the
  // deploy.yml migration ships.
});
