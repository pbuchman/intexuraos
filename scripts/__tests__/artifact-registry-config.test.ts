import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

describe('artifact registry prevention config', () => {
  it('does not retain monolith app deployment flows or rebuild code-worker through them', () => {
    const deployWorkflow = readRepoFile('.github/workflows/deploy.yml');

    expect(fs.existsSync(path.join(REPO_ROOT, 'cloudbuild/cloudbuild.yaml'))).toBe(false);
    expect(deployWorkflow).not.toContain('deploy-monolith');
    expect(deployWorkflow).not.toContain('build-push-monitored.sh image-service');
    expect(deployWorkflow).not.toContain('deploy-web.sh');
    expect(deployWorkflow).not.toContain(
      'bash cloudbuild/scripts/build-push-monitored.sh code-worker docker/code-worker/Dockerfile &'
    );
  });

  it('gives the standalone code-worker Cloud Build extra time for multi-arch export and push', () => {
    const codeWorkerCloudBuild = readRepoFile('docker/code-worker/cloudbuild.yaml');

    expect(codeWorkerCloudBuild).toMatch(/timeout:\s*['"]3600s['"]/);
  });

  it('defines active delete cleanup policies and aggressive env retention settings', () => {
    const moduleMain = readRepoFile('terraform/modules/artifact-registry/main.tf');
    const moduleVariables = readRepoFile('terraform/modules/artifact-registry/variables.tf');
    const environmentMain = readRepoFile('terraform/environments/dev/main.tf');

    expect(moduleMain).toContain('cleanup_policy_dry_run');
    expect(moduleMain).toContain('action = "DELETE"');
    expect(moduleMain).toContain('package_name_prefixes = ["code-worker"]');
    expect(moduleMain).toContain('keep_count = var.cleanup_keep_count');
    expect(moduleMain).toContain('tag_state  = "ANY"');
    expect(moduleMain).toContain('tag_state             = "ANY"');

    expect(moduleVariables).toContain('variable "cleanup_policy_dry_run"');
    expect(moduleVariables).toContain('variable "cleanup_keep_count"');
    expect(moduleVariables).toContain('variable "cleanup_delete_older_than"');
    expect(moduleVariables).toContain('variable "code_worker_cleanup_delete_older_than"');

    expect(environmentMain).toMatch(/cleanup_policy_dry_run\s*=\s*false/);
    expect(environmentMain).toMatch(/cleanup_keep_count\s*=\s*1/);
    expect(environmentMain).toMatch(/cleanup_delete_older_than\s*=\s*"259200s"/);
    expect(environmentMain).toMatch(/code_worker_cleanup_delete_older_than\s*=\s*"86400s"/);
  });
});
