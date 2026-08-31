import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const devSetupSource = readFileSync(resolve(repoRoot, 'scripts/dev-setup.mjs'), 'utf8');
const dockerComposeSource = readFileSync(
  resolve(repoRoot, 'scripts/docker-compose-local.mjs'),
  'utf8'
);
const ecosystemSource = readFileSync(resolve(repoRoot, 'ecosystem.config.cjs'), 'utf8');
const logViewerSource = readFileSync(resolve(repoRoot, 'scripts/log-viewer.mjs'), 'utf8');

describe('local development scripts', () => {
  it('refreshes PM2 environment when starting services', () => {
    expect(packageJson.scripts.dev).toContain('pm2 start ecosystem.config.cjs --update-env');
    expect(packageJson.scripts['services:start']).toBe(
      'node scripts/run-home-dev-runtime-command.mjs pnpm exec pm2 start ecosystem.config.cjs --update-env'
    );
  });

  it('refreshes PM2 environment when restarting services', () => {
    expect(packageJson.scripts['services:restart']).toBe(
      'node scripts/run-home-dev-runtime-command.mjs pnpm exec pm2 delete all || true; node scripts/run-home-dev-runtime-command.mjs pnpm exec pm2 start ecosystem.config.cjs --update-env'
    );
  });

  it('holds the Home Dev mode lock around every normal PM2 or emulator start path', () => {
    expect(packageJson.scripts.dev).toMatch(
      /dev-setup\.mjs && node scripts\/run-home-dev-runtime-command\.mjs pnpm exec pm2 start/u
    );
    for (const [name, command] of Object.entries(packageJson.scripts)) {
      if (!name.startsWith('services:') && name !== 'dev') continue;
      expect(command).not.toMatch(/(?:^|[;&|]\s*)pnpm exec pm2/u);
      if (command.includes('pm2')) {
        expect(command).toContain('node scripts/run-home-dev-runtime-command.mjs');
      }
    }
    expect(devSetupSource).toContain('runHomeDevRuntimeCommand');
    expect(dockerComposeSource).toContain(
      "const result = runHomeDevRuntimeCommand('docker', command, options);"
    );
    expect(dockerComposeSource).not.toContain('args.some');
    for (const startCapableCommand of ['watch', 'scale', 'unpause', 'alpha']) {
      expect(dockerComposeSource).not.toContain(`['${startCapableCommand}'`);
    }
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
      'node scripts/docker-compose-local.mjs start'
    );
    expect(packageJson.scripts['emulators:stop']).toBe(
      'node scripts/docker-compose-local.mjs down'
    );
    expect(packageJson.scripts['emulators:logs']).toBe(
      'node scripts/docker-compose-local.mjs logs -f'
    );
    expect(devSetupSource).toContain(
      "import { buildLocalEmulatorStartPlan } from './lib/local-emulator-lifecycle.mjs';"
    );
    expect(devSetupSource).toContain('for (const command of buildLocalEmulatorStartPlan())');
    expect(devSetupSource).toMatch(/runHomeDevRuntimeCommand\(\s*'docker'/u);
  });
});
