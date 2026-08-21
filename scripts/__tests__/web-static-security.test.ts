import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');
const verifier = resolve(repoRoot, 'scripts', 'verify-web-static-build.mjs');

describe('web static artifact security', () => {
  it('disables source maps and runs the artifact verifier after every web build', () => {
    const vite = readFileSync(resolve(repoRoot, 'apps/web/vite.config.ts'), 'utf8');
    const packageJson = JSON.parse(
      readFileSync(resolve(repoRoot, 'apps/web/package.json'), 'utf8')
    ) as { scripts: { build: string } };

    expect(vite).toContain('sourcemap: false');
    expect(vite).toContain("name: 'strip-source-map-references'");
    expect(packageJson.scripts.build).toContain('verify-web-static-build.mjs dist');
  });

  it('accepts a static build without maps or Vite development paths', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'web-static-safe-'));
    mkdirSync(join(fixture, 'assets'));
    writeFileSync(
      join(fixture, 'index.html'),
      '<div id="root"></div><script src="/assets/app.js"></script>'
    );
    writeFileSync(join(fixture, 'assets/app.js'), 'console.log("safe")');

    expect(() => execFileSync(process.execPath, [verifier, fixture])).not.toThrow();
  });

  it.each([
    ['source map file', 'assets/app.js.map', '{}'],
    ['source map reference', 'assets/app.js', '//# sourceMappingURL=app.js.map'],
    ['Vite source path', 'index.html', '<script src="/src/main.tsx"></script>'],
    ['Vite client path', 'index.html', '<script src="/@vite/client"></script>'],
    ['filesystem path', 'index.html', '<script src="/@fs/private.ts"></script>'],
  ])('rejects a %s', (_label, relativePath, contents) => {
    const fixture = mkdtempSync(join(tmpdir(), 'web-static-unsafe-'));
    mkdirSync(join(fixture, 'assets'), { recursive: true });
    writeFileSync(join(fixture, 'index.html'), '<div id="root"></div>');
    const target = join(fixture, relativePath);
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, contents);

    expect(spawnSync(process.execPath, [verifier, fixture]).status).not.toBe(0);
  });

  it('sets no-cache headers for HTML and service workers at both origins', () => {
    const caddy = execFileSync(
      process.execPath,
      [resolve(repoRoot, 'scripts/generate-dev-caddy.mjs')],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      }
    );
    const nginx = readFileSync(resolve(repoRoot, 'scripts/hetzner/nginx/intexuraos.conf'), 'utf8');
    const noCache = 'no-cache, no-store, must-revalidate';

    expect(caddy).toContain(`Cache-Control "${noCache}"`);
    expect(caddy).toContain('path / /index.html /sw.js /manifest.webmanifest');
    expect(nginx).toMatch(
      new RegExp(`location / \\{[\\s\\S]*Cache-Control "${noCache}"[\\s\\S]*try_files`)
    );
  });
});
