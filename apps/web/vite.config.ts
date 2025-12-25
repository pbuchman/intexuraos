import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

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

  return {
    plugins: [react(), tailwindcss()],
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
