import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function extractTerraformStringList(content: string, listName: string): string[] {
  const match = content.match(new RegExp(`${listName}\\s*=\\s*\\[(.*?)\\]`, 's'));

  if (!match?.[1]) {
    throw new Error(`Could not find Terraform list ${listName}`);
  }

  return Array.from(match[1].matchAll(/"([^"]+)"/g), (entry) => entry[1]).sort();
}

function listStandaloneAppBuildTargets(): string[] {
  return fs
    .readdirSync(path.join(REPO_ROOT, 'apps'))
    .filter((name) => {
      const appDir = path.join(REPO_ROOT, 'apps', name);
      return (
        fs.statSync(appDir).isDirectory() &&
        name !== 'web' &&
        fs.existsSync(path.join(appDir, 'Dockerfile')) &&
        fs.existsSync(path.join(appDir, 'cloudbuild.yaml'))
      );
    })
    .sort();
}

function listStandaloneWorkerBuildTargets(): string[] {
  return fs
    .readdirSync(path.join(REPO_ROOT, 'workers'))
    .filter((name) => {
      const workerDir = path.join(REPO_ROOT, 'workers', name);
      return (
        fs.statSync(workerDir).isDirectory() &&
        fs.existsSync(path.join(workerDir, 'cloudbuild.yaml'))
      );
    })
    .sort();
}

describe('Cloud Build trigger configuration', () => {
  it('does not retain Cloud Build triggers or configs for migrated app/web services', () => {
    const cloudBuildModule = readRepoFile('terraform/modules/cloud-build/main.tf');

    expect(listStandaloneAppBuildTargets()).toEqual([]);
    expect(fs.existsSync(path.join(REPO_ROOT, 'apps/web/cloudbuild.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, 'cloudbuild/cloudbuild.yaml'))).toBe(false);

    expect(cloudBuildModule).not.toContain('docker_services');
    expect(cloudBuildModule).not.toContain('google_cloudbuild_trigger" "manual_main"');
    expect(cloudBuildModule).not.toContain('google_cloudbuild_trigger" "service"');
    expect(cloudBuildModule).not.toContain('google_cloudbuild_trigger" "web"');
    expect(cloudBuildModule).not.toContain('filename = "apps/${each.key}/cloudbuild.yaml"');
    expect(cloudBuildModule).not.toContain('filename = "apps/web/cloudbuild.yaml"');
    expect(cloudBuildModule).not.toContain('filename = "cloudbuild/cloudbuild.yaml"');
  });

  it('keeps Terraform worker triggers aligned with standalone worker Cloud Build configs', () => {
    const cloudBuildModule = readRepoFile('terraform/modules/cloud-build/main.tf');
    const workerTargets = extractTerraformStringList(cloudBuildModule, 'cloud_function_workers');

    expect(workerTargets).toEqual(listStandaloneWorkerBuildTargets());
    expect(workerTargets).not.toContain('log-cleanup');
  });
});
