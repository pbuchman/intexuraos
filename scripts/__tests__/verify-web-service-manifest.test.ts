/**
 * Tests for the web service manifest single-source-of-truth contract.
 *
 * The manifest at apps/web/service-manifest.json drives service URL injection
 * for local development and the Hetzner web build. GCP Cloud Build no longer
 * owns migrated app/web deployments, so these tests also pin that obsolete
 * Cloud Build web configs and deploy.yml service arrays stay removed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');

const manifestPath = resolve(repoRoot, 'apps/web/service-manifest.json');
const cloudbuildPath = resolve(repoRoot, 'apps/web/cloudbuild.yaml');
const monolithCloudbuildPath = resolve(repoRoot, 'cloudbuild/cloudbuild.yaml');
const deployWorkflowPath = resolve(repoRoot, '.github/workflows/deploy.yml');
const viteConfigPath = resolve(repoRoot, 'apps/web/vite.config.ts');
const terraformServiceUrlsPath = resolve(
  repoRoot,
  'terraform/environments/dev/service-urls.auto.tfvars.json'
);

const NAME_REGEX = /^[a-z][a-z0-9-]+$/;
const ENV_SUFFIX_REGEX = /^[A-Z][A-Z0-9_]+$/;
const API_PATH_REGEX = /^\/api\/[a-z0-9-]+$/;
const URL_REGEX = /^https?:\/\/\S+$/;
const retiredAgentNames = ['todos', 'chat', 'cron'].map((prefix) => `${prefix}-agent`);

describe('apps/web/service-manifest.json', () => {
  it('exists and parses as JSON', () => {
    expect(existsSync(manifestPath)).toBe(true);
    const raw = readFileSync(manifestPath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('has at least 17 active service entries', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(Array.isArray(manifest.services)).toBe(true);
    expect(manifest.services.length).toBeGreaterThanOrEqual(17);
    expect(manifest.services.map((service) => service.name)).not.toEqual(
      expect.arrayContaining(retiredAgentNames)
    );
  });

  it('each entry has valid name, envSuffix, apiPath, proxyTarget, and serviceUrl fields', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const entry of manifest.services) {
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.name).toMatch(NAME_REGEX);
      expect(typeof entry.envSuffix).toBe('string');
      expect(entry.envSuffix.length).toBeGreaterThan(0);
      expect(entry.envSuffix).toMatch(ENV_SUFFIX_REGEX);
      expect(typeof entry.apiPath).toBe('string');
      expect(entry.apiPath).toMatch(API_PATH_REGEX);
      expect(typeof entry.proxyTarget).toBe('string');
      expect(entry.proxyTarget).toMatch(URL_REGEX);
      expect(typeof entry.serviceUrl).toBe('string');
      expect(entry.serviceUrl).toMatch(URL_REGEX);
    }
  });

  it('does not duplicate names, envSuffixes, or apiPath values', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const names = new Set();
    const envSuffixes = new Set();
    const apiPaths = new Set();

    for (const entry of manifest.services) {
      expect(names.has(entry.name)).toBe(false);
      expect(envSuffixes.has(entry.envSuffix)).toBe(false);
      expect(apiPaths.has(entry.apiPath)).toBe(false);
      names.add(entry.name);
      envSuffixes.add(entry.envSuffix);
      apiPaths.add(entry.apiPath);
    }
  });

  it('terraform service URL tfvars mirror manifest serviceUrl values', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const tfvars = JSON.parse(readFileSync(terraformServiceUrlsPath, 'utf8'));
    const expected: Record<string, string> = {};
    for (const entry of manifest.services) {
      expected[`INTEXURAOS_${entry.envSuffix}_URL`] = entry.serviceUrl;
    }
    expect(tfvars.service_urls).toEqual(expected);
  });
});

describe('migrated web deployment is not wired to GCP Cloud Build', () => {
  it('removes obsolete app/web Cloud Build configs and deploy workflow arrays', () => {
    expect(existsSync(cloudbuildPath)).toBe(false);
    expect(existsSync(monolithCloudbuildPath)).toBe(false);

    const deployWorkflow = readFileSync(deployWorkflowPath, 'utf8');
    expect(deployWorkflow).not.toContain('CLOUD_RUN_SERVICES=(');
    expect(deployWorkflow).not.toContain('apps/web/cloudbuild.yaml');
    expect(deployWorkflow).not.toContain('cloudbuild/cloudbuild.yaml');
  });

  it('PWA navigation fallback excludes retained bucket routes', () => {
    const content = readFileSync(viteConfigPath, 'utf8');
    expect(content).toContain('navigateFallbackDenylist');
    expect(content).toContain('/^\\/share\\//');
    expect(content).toContain('/^\\/images\\//');
  });
});
