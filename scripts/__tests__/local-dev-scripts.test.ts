import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const devSetupSource = readFileSync(resolve(repoRoot, 'scripts/dev-setup.mjs'), 'utf8');
const ecosystemSource = readFileSync(resolve(repoRoot, 'ecosystem.config.cjs'), 'utf8');
const logViewerSource = readFileSync(resolve(repoRoot, 'scripts/log-viewer.mjs'), 'utf8');

describe('local development scripts', () => {
  it('refreshes PM2 environment when starting services', () => {
    expect(packageJson.scripts.dev).toContain('pm2 start ecosystem.config.cjs --update-env');
    expect(packageJson.scripts['services:start']).toBe(
      'pnpm exec pm2 start ecosystem.config.cjs --update-env'
    );
  });

  it('refreshes PM2 environment when restarting services', () => {
    expect(packageJson.scripts['services:restart']).toBe(
      'pnpm exec pm2 delete all || true; pnpm exec pm2 start ecosystem.config.cjs --update-env'
    );
  });

  it('prints the actual API Docs Hub port used by PM2', () => {
    expect(devSetupSource).toContain('API Docs Hub:   http://localhost:8133/docs');
    expect(devSetupSource).not.toContain('API Docs Hub:   http://localhost:8115/docs');
  });

  it('checks every PM2 service port before starting local setup', () => {
    const ecosystemPorts = [
      ...ecosystemSource.matchAll(/createServiceConfig\('[^']+', (\d+)/g),
    ].map((match) => Number(match[1]));
    const setupPorts = [...devSetupSource.matchAll(/port: (\d+)/g)].map((match) =>
      Number(match[1])
    );

    expect(setupPorts).toEqual(expect.arrayContaining(ecosystemPorts));
  });

  it('registers Message Digest consistently in local setup and compact logs', () => {
    expect(devSetupSource).toContain("{ name: 'message-digest-service', port: 8135 }");
    expect(logViewerSource).toContain("'message-digest-service': 'digests'");
    expect(logViewerSource).toContain("'message-': 'digests'");
  });

  it('runs emulator compose commands through the Docker config wrapper', () => {
    expect(packageJson.scripts['emulators:start']).toBe(
      'node scripts/docker-compose-local.mjs up -d'
    );
    expect(packageJson.scripts['emulators:stop']).toBe(
      'node scripts/docker-compose-local.mjs down'
    );
    expect(packageJson.scripts['emulators:logs']).toBe(
      'node scripts/docker-compose-local.mjs logs -f'
    );
  });
});
