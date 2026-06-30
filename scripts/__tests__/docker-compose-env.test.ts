import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDockerComposeEnv } from '../lib/docker-compose-env.mjs';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const root = join(tmpdir(), `intex-docker-env-test-${String(Date.now())}-${Math.random()}`);
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

describe('createDockerComposeEnv', () => {
  it('removes a blocking Docker Desktop credsStore while preserving compose plugins and contexts', () => {
    const root = makeTempRoot();
    const home = join(root, 'home');
    const dockerConfigDir = join(home, '.docker');
    const pluginDir = join(dockerConfigDir, 'cli-plugins');
    const contextDir = join(dockerConfigDir, 'contexts');
    mkdirSync(pluginDir, { recursive: true });
    mkdirSync(join(contextDir, 'meta', 'desktop-linux'), { recursive: true });
    writeFileSync(join(pluginDir, 'docker-compose'), '');
    writeFileSync(join(contextDir, 'meta', 'desktop-linux', 'meta.json'), '{}');
    writeFileSync(
      join(dockerConfigDir, 'config.json'),
      JSON.stringify({
        auths: { 'europe-central2-docker.pkg.dev': {} },
        credsStore: 'desktop',
        credHelpers: { gcr: 'gcloud' },
        currentContext: 'desktop-linux',
      })
    );

    const result = createDockerComposeEnv({
      env: { HOME: home, PATH: '/bin' },
      tmpParent: root,
    });
    tempRoots.push(result.dockerConfigDir);

    expect(result.env.DOCKER_CONFIG).toBe(result.dockerConfigDir);

    const rewritten = JSON.parse(
      readFileSync(join(result.dockerConfigDir, 'config.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(rewritten.credsStore).toBeUndefined();
    expect(rewritten.credHelpers).toEqual({ gcr: 'gcloud' });
    expect(rewritten.currentContext).toBe('desktop-linux');
    expect(existsSync(join(result.dockerConfigDir, 'cli-plugins'))).toBe(true);
    expect(lstatSync(join(result.dockerConfigDir, 'cli-plugins')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(result.dockerConfigDir, 'contexts'))).toBe(true);
    expect(lstatSync(join(result.dockerConfigDir, 'contexts')).isSymbolicLink()).toBe(true);

    result.cleanup();
    expect(existsSync(result.dockerConfigDir)).toBe(false);
  });

  it('keeps the caller environment unchanged when no credsStore is configured', () => {
    const root = makeTempRoot();
    const home = join(root, 'home');
    const dockerConfigDir = join(home, '.docker');
    mkdirSync(dockerConfigDir, { recursive: true });
    writeFileSync(join(dockerConfigDir, 'config.json'), JSON.stringify({ auths: {} }));

    const env = { HOME: home, PATH: '/bin', DOCKER_CONFIG: dockerConfigDir };
    const result = createDockerComposeEnv({ env, tmpParent: root });

    expect(result.env).toBe(env);
    expect(result.dockerConfigDir).toBe(dockerConfigDir);

    result.cleanup();
    expect(existsSync(dockerConfigDir)).toBe(true);
  });
});
