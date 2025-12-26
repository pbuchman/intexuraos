import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { execSync } from 'child_process';

// Get build metadata
function getBuildMetadata(): { sha: string; date: string } {
  let sha = 'unknown';
  try {
    sha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    // Git not available or not a git repo
  }
  const date = new Date().toISOString();
  return { sha, date };
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

  // Get build metadata for injection into HTML
  const buildMeta = getBuildMetadata();

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'inject-build-metadata',
        transformIndexHtml(html): string {
          return html
            .replaceAll('__BUILD_SHA__', buildMeta.sha)
            .replaceAll('__BUILD_DATE__', buildMeta.date);
        },
      },
    ],
    // Expose INTEXURAOS_ prefixed env vars to the client
    envPrefix: 'INTEXURAOS_',
    define: {
      // Make shell env vars available to import.meta.env
      ...Object.fromEntries(
        Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])
      ),
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
