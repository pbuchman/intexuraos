import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = resolve(import.meta.dirname, '../../..');
const viteConfigPath = resolve(webRoot, 'vite.config.ts');

describe('localhost OAuth callback proxy', () => {
  it('forwards OAuth callbacks unchanged to user-service for dev and preview', () => {
    const script = `
      import { resolveConfig } from 'vite';
      const config = await resolveConfig(
        { configFile: ${JSON.stringify(viteConfigPath)}, mode: 'development' },
        'serve'
      );
      const summarize = (proxy) => {
        const callback = proxy?.['/oauth/connections'];
        const userApi = proxy?.['/api/user'];
        const whatsappApi = proxy?.['/api/whatsapp'];
        return {
          callback: {
            target: callback?.target,
            changeOrigin: callback?.changeOrigin,
            rewriteType: typeof callback?.rewrite,
          },
          userApi: {
            target: userApi?.target,
            rewrittenPath: userApi?.rewrite?.('/api/user/oauth/connections/google/initiate'),
          },
          whatsappApi: {
            target: whatsappApi?.target,
            rewrittenPath: whatsappApi?.rewrite?.('/api/whatsapp/health'),
          },
        };
      };
      process.stdout.write(JSON.stringify({
        server: summarize(config.server.proxy),
        preview: summarize(config.preview.proxy),
      }));
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: webRoot,
      encoding: 'utf8',
    });
    const resolved = JSON.parse(output) as Record<string, unknown>;

    expect(resolved).toEqual(
      {
        server: {
          callback: {
            target: 'http://localhost:8110',
            changeOrigin: false,
            rewriteType: 'undefined',
          },
          userApi: {
            target: 'http://localhost:8110',
            rewrittenPath: '/oauth/connections/google/initiate',
          },
          whatsappApi: {
            target: 'http://localhost:8113',
            rewrittenPath: '/health',
          },
        },
        preview: {
          callback: {
            target: 'http://localhost:8110',
            changeOrigin: false,
            rewriteType: 'undefined',
          },
          userApi: {
            target: 'http://localhost:8110',
            rewrittenPath: '/oauth/connections/google/initiate',
          },
          whatsappApi: {
            target: 'http://localhost:8113',
            rewrittenPath: '/health',
          },
        },
      }
    );
  });
});
