import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();

function readPackageJson(relativePath: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
}

describe('Cloud Run runtime dependency declarations', () => {
  it('keeps infra-firestore production-installable in Cloud Run images', () => {
    const pkg = readPackageJson('packages/infra-firestore/package.json');

    expect(pkg.dependencies?.['@google-cloud/firestore']).toBe('catalog:');
    expect(pkg.devDependencies?.['@google-cloud/firestore']).toBeUndefined();
    expect(pkg.peerDependencies?.['@google-cloud/firestore']).toBeUndefined();
  });

  it('keeps code-agent direct Firestore runtime imports in production dependencies', () => {
    const pkg = readPackageJson('apps/code-agent/package.json');

    expect(pkg.dependencies?.['@google-cloud/firestore']).toBe('catalog:');
    expect(pkg.devDependencies?.['@google-cloud/firestore']).toBeUndefined();
  });

  it('keeps infra-gpt production-installable in Cloud Run images', () => {
    const pkg = readPackageJson('packages/infra-gpt/package.json');

    expect(pkg.dependencies?.openai).toBe('catalog:');
    expect(pkg.devDependencies?.openai).toBeUndefined();
    expect(pkg.peerDependencies?.openai).toBeUndefined();
  });

  it('keeps common-http production-installable in Cloud Run images', () => {
    const pkg = readPackageJson('packages/common-http/package.json');

    expect(pkg.dependencies?.zod).toBe('catalog:');
    expect(pkg.devDependencies?.zod).toBeUndefined();
    expect(pkg.peerDependencies?.zod).toBeUndefined();
  });
});
