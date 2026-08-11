import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

describe('Cloud Build worker configuration', () => {
  it('runs retained GCP deployments through explicit Cloud Build trigger names only', () => {
    const cloudBuildModule = readRepoFile('terraform/modules/cloud-build/main.tf');
    const deployWorkflow = readRepoFile('.github/workflows/deploy.yml');

    expect(cloudBuildModule).toContain('"transcription"');
    expect(cloudBuildModule).not.toContain('"vm-lifecycle"');
    expect(cloudBuildModule).not.toContain('"log-cleanup"');

    expect(deployWorkflow).toContain('gcloud builds triggers run "$TARGET"');
    expect(deployWorkflow).toContain('firestore');
    expect(deployWorkflow).not.toContain('vm-lifecycle');
    expect(deployWorkflow).toContain('transcription');
    expect(deployWorkflow).toContain('code-worker');
    expect(deployWorkflow).not.toContain('deploy-monolith');
    expect(deployWorkflow).not.toContain('smart-dispatch');
    expect(deployWorkflow).not.toContain('build-push-monitored.sh image-service');
    expect(deployWorkflow).not.toContain('deploy-web.sh');
    expect(deployWorkflow).not.toContain('deploy-function.sh transcription &');
    expect(deployWorkflow).not.toContain(
      'bash cloudbuild/scripts/deploy-function.sh log-cleanup &'
    );
  });

  it('includes transcription in the consolidated worker scripts', () => {
    const buildAllWorkers = readRepoFile('cloudbuild/scripts/build-all-workers.sh');
    const deployAllWorkers = readRepoFile('cloudbuild/scripts/deploy-all-workers.sh');
    const deployFunction = readRepoFile('cloudbuild/scripts/deploy-function.sh');

    expect(buildAllWorkers).toContain('WORKERS=(transcription)');
    expect(deployAllWorkers).toContain('WORKERS=(transcription)');
    expect(deployFunction).toContain('transcription)');
    expect(deployFunction).toContain('FUNCTIONS=("intexuraos-transcription-${ENVIRONMENT}")');
  });

  it('provides a standalone Cloud Build config for the transcription worker trigger', () => {
    const transcriptionCloudBuild = readRepoFile('workers/transcription/cloudbuild.yaml');

    expect(transcriptionCloudBuild).toContain('pnpm --filter @intexuraos/transcription build');
    expect(transcriptionCloudBuild).toContain(
      "args: ['cloudbuild/scripts/deploy-function.sh', 'transcription']"
    );
    expect(transcriptionCloudBuild).toContain('corepack prepare pnpm@10 --activate');
    expect(fs.existsSync(path.join(REPO_ROOT, 'workers/vm-lifecycle/cloudbuild.yaml'))).toBe(false);
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
