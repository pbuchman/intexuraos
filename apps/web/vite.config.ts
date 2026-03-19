import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

interface BuildInfo {
  version: string;
  shortSha: string;
  fullSha: string;
  commitMessage: string;
  buildDate: string;
}

function getBuildInfo(): BuildInfo {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
    version: string;
  };

  let shortSha = 'unknown';
  let fullSha = 'unknown';
  let commitMessage = 'Unknown commit';

  if (process.env['COMMIT_SHA'] !== undefined && process.env['COMMIT_SHA'] !== '') {
    fullSha = process.env['COMMIT_SHA'];
    shortSha = fullSha.slice(0, 7);
  }

  if (process.env['COMMIT_MESSAGE'] !== undefined && process.env['COMMIT_MESSAGE'] !== '') {
    commitMessage = process.env['COMMIT_MESSAGE'];
  }

  // Fallback to git for local development or missing env vars
  try {
    if (shortSha === 'unknown') {
      shortSha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    }
    if (fullSha === 'unknown') {
      fullSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    }
    if (commitMessage === 'Unknown commit') {
      commitMessage = execSync('git log -1 --pretty=%s', { encoding: 'utf-8' }).trim();
    }
  } catch {
    // Git not available or not a git repo
  }

  return {
    version: pkg.version,
    shortSha,
    fullSha,
    commitMessage,
    buildDate: new Date().toISOString(),
  };
}

export default defineConfig(({ mode }) => {
  // Load env from .env files
  const fileEnv = loadEnv(mode, process.cwd(), 'INTEXURAOS_');

  // Also pick up INTEXURAOS_ vars from shell environment (direnv)
  const shellEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('INTEXURAOS_') && value !== undefined) {
      shellEnv[key] = value;
    }
  }

  // Merge: file env takes precedence over shell env
  const env = { ...shellEnv, ...fileEnv };

  const buildInfo = getBuildInfo();
  const buildVersion = `${buildInfo.version}-${buildInfo.shortSha}`;

  // Proxy routes shared between dev server and preview — strips /api/<service> prefix
  const apiProxy = {
    '/api/user': { target: 'http://localhost:8110', rewrite: (p: string) => p.replace(/^\/api\/user/, '') },
    '/api/notion': { target: 'http://localhost:8112', rewrite: (p: string) => p.replace(/^\/api\/notion/, '') },
    '/api/whatsapp': { target: 'http://localhost:8113', rewrite: (p: string) => p.replace(/^\/api\/whatsapp/, '') },
    '/api/notifications': { target: 'http://localhost:8114', rewrite: (p: string) => p.replace(/^\/api\/notifications/, '') },
    '/api/research': { target: 'http://localhost:8116', rewrite: (p: string) => p.replace(/^\/api\/research/, '') },
    '/api/commands': { target: 'http://localhost:8117', rewrite: (p: string) => p.replace(/^\/api\/commands/, '') },
    '/api/actions': { target: 'http://localhost:8118', rewrite: (p: string) => p.replace(/^\/api\/actions/, '') },
    '/api/data-insights': { target: 'http://localhost:8119', rewrite: (p: string) => p.replace(/^\/api\/data-insights/, '') },
    '/api/images': { target: 'http://localhost:8120', rewrite: (p: string) => p.replace(/^\/api\/images/, '') },
    '/api/notes': { target: 'http://localhost:8121', rewrite: (p: string) => p.replace(/^\/api\/notes/, '') },
    '/api/settings': { target: 'http://localhost:8122', rewrite: (p: string) => p.replace(/^\/api\/settings/, '') },
    '/api/todos': { target: 'http://localhost:8123', rewrite: (p: string) => p.replace(/^\/api\/todos/, '') },
    '/api/bookmarks': { target: 'http://localhost:8124', rewrite: (p: string) => p.replace(/^\/api\/bookmarks/, '') },
    '/api/calendar': { target: 'http://localhost:8125', rewrite: (p: string) => p.replace(/^\/api\/calendar/, '') },
    '/api/linear': { target: 'http://localhost:8126', rewrite: (p: string) => p.replace(/^\/api\/linear/, '') },
    '/api/web': { target: 'http://localhost:8127', rewrite: (p: string) => p.replace(/^\/api\/web/, '') },
    '/api/code': { target: 'http://localhost:8128', rewrite: (p: string) => p.replace(/^\/api\/code/, '') },
    '/api/chat': { target: 'http://localhost:8129', rewrite: (p: string) => p.replace(/^\/api\/chat/, '') },
    '/api/cron-agent': { target: 'http://localhost:8130', rewrite: (p: string) => p.replace(/^\/api\/cron-agent/, '') },
  };

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.png', 'logo.png'],
        manifest: {
          name: 'IntexuraOS',
          short_name: 'IntexuraOS',
          description: 'Personal operating system for life management',
          theme_color: '#2563eb',
          background_color: '#f8fafc',
          display: 'standalone',
          orientation: 'portrait-primary',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          share_target: {
            action: '/share-target',
            method: 'GET',
            params: {
              title: 'title',
              text: 'text',
              url: 'url',
            },
          },
        },
        workbox: {
          // Allow larger bundles (libraries: Vega, Auth0, Chat components ~4.5MB)
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          // Skip waiting to activate new service worker immediately
          skipWaiting: true,
          clientsClaim: true,
          // Cache strategies for SPA
          runtimeCaching: [
            {
              // JS/CSS - stale while revalidate for faster updates
              urlPattern: /\.(?:js|css)$/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'static-resources',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
                },
              },
            },
            {
              // Images - cache first
              urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'image-cache',
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                },
              },
            },
            {
              // Fonts - cache first
              urlPattern: /\.(?:woff|woff2|ttf|eot)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'font-cache',
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
                },
              },
            },
          ],
          // Don't cache API requests
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api/, /^\/health/, /^\/openapi\.json/, /^\/share\//],
        },
        devOptions: {
          enabled: true, // Generate manifest in dev mode
          type: 'module',
          suppressWarnings: true,
        },
      }),
    ],
    // Expose INTEXURAOS_ prefixed env vars to the client
    envPrefix: 'INTEXURAOS_',
    define: {
      // Make shell env vars available to import.meta.env
      ...Object.fromEntries(
        Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])
      ),
      'import.meta.env.INTEXURAOS_BUILD_VERSION': JSON.stringify(buildVersion),
      'import.meta.env.INTEXURAOS_COMMIT_SHA': JSON.stringify(buildInfo.fullSha),
      'import.meta.env.INTEXURAOS_COMMIT_MESSAGE': JSON.stringify(buildInfo.commitMessage),
      'import.meta.env.INTEXURAOS_BUILD_DATE': JSON.stringify(buildInfo.buildDate),
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
    },
    server: {
      allowedHosts: true,
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      hmr: false,
      proxy: apiProxy,
    },
    preview: {
      allowedHosts: true,
      port: 3000,
      strictPort: true,
      host: '0.0.0.0',
      proxy: apiProxy,
    },
  };
});
