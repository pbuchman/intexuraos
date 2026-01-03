import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

function getBuildVersion(): string {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
    version: string;
  };
  let sha = 'unknown';
  try {
    sha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    // Git not available or not a git repo
  }
  return `${pkg.version}-${sha}`;
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

  const buildVersion = getBuildVersion();

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
            action: '/',
            method: 'GET',
            params: {
              title: 'title',
              text: 'text',
              url: 'url',
            },
          },
        },
        workbox: {
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
          enabled: false, // Disable in dev mode to avoid caching issues
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
      port: 3000,
      strictPort: true,
    },
    preview: {
      port: 3000,
      strictPort: true,
    },
  };
});
