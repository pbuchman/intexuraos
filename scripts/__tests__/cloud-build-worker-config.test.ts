import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

describe('Cloud Build worker configuration', () => {
  it('registers the actual Cloud Function workers and removes stale log-cleanup references', () => {
    const cloudBuildModule = readRepoFile('terraform/modules/cloud-build/main.tf');
    const deployWorkflow = readRepoFile('.github/workflows/deploy.yml');

    expect(cloudBuildModule).toContain('"vm-lifecycle"');
    expect(cloudBuildModule).toContain('"transcription"');
    expect(cloudBuildModule).not.toContain('"log-cleanup"');

    expect(deployWorkflow).toContain('bash cloudbuild/scripts/deploy-function.sh transcription &');
    expect(deployWorkflow).not.toContain(
      'bash cloudbuild/scripts/deploy-function.sh log-cleanup &'
    );
  });

  it('includes transcription in the consolidated worker scripts', () => {
    const buildAllWorkers = readRepoFile('cloudbuild/scripts/build-all-workers.sh');
    const deployAllWorkers = readRepoFile('cloudbuild/scripts/deploy-all-workers.sh');
    const deployFunction = readRepoFile('cloudbuild/scripts/deploy-function.sh');

    expect(buildAllWorkers).toContain('WORKERS=(vm-lifecycle transcription)');
    expect(deployAllWorkers).toContain('WORKERS=(vm-lifecycle transcription)');
    expect(deployFunction).toContain('transcription)');
    expect(deployFunction).toContain('FUNCTIONS=("intexuraos-transcription-${ENVIRONMENT}")');
  });

  it('provides a standalone Cloud Build config for the transcription worker trigger', () => {
    const transcriptionCloudBuild = readRepoFile('workers/transcription/cloudbuild.yaml');
    const vmLifecycleCloudBuild = readRepoFile('workers/vm-lifecycle/cloudbuild.yaml');

    expect(transcriptionCloudBuild).toContain('pnpm --filter @intexuraos/transcription build');
    expect(transcriptionCloudBuild).toContain(
      "args: ['cloudbuild/scripts/deploy-function.sh', 'transcription']"
    );
    expect(transcriptionCloudBuild).toContain('corepack prepare pnpm@10 --activate');
    expect(vmLifecycleCloudBuild).toContain('corepack prepare pnpm@10 --activate');
  });

  it('gives the code-worker multi-arch image rebuild enough Cloud Build time', () => {
    const codeWorkerCloudBuild = readRepoFile('docker/code-worker/cloudbuild.yaml');

    expect(codeWorkerCloudBuild).toMatch(/timeout:\s*['"]3600s['"]/);
    expect(codeWorkerCloudBuild).toContain('multi-arch scheduled image rebuild');
  });

  it('installs gcloud from architecture-specific archives without the self-updating installer', () => {
    const codeWorkerDockerfile = readRepoFile('docker/code-worker/Dockerfile');

    expect(codeWorkerDockerfile).not.toContain('curl -sSL https://sdk.cloud.google.com | bash');
    expect(codeWorkerDockerfile).toContain('amd64) GCLOUD_ARCH="x86_64"');
    expect(codeWorkerDockerfile).toContain('arm64) GCLOUD_ARCH="arm"');
    expect(codeWorkerDockerfile).toContain(
      'https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-${GCLOUD_ARCH}.tar.gz'
    );
    expect(codeWorkerDockerfile).toContain('/opt/google-cloud-sdk/install.sh --quiet');
  });
});
