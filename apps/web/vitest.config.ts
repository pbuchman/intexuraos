import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Set up environment variables for tests
process.env.INTEXURAOS_AUTH0_DOMAIN = 'test-domain';
process.env.INTEXURAOS_AUTH0_SPA_CLIENT_ID = 'test-client-id';
process.env.INTEXURAOS_AUTH_AUDIENCE = 'test-audience';
process.env.INTEXURAOS_USER_SERVICE_URL = 'http://localhost:8110';
process.env.INTEXURAOS_WHATSAPP_SERVICE_URL = 'http://localhost:8113';
process.env.INTEXURAOS_NOTION_SERVICE_URL = 'http://localhost:8112';
process.env.INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL = 'http://localhost:8114';
process.env.INTEXURAOS_RESEARCH_AGENT_URL = 'http://localhost:8116';
process.env.INTEXURAOS_COMMANDS_AGENT_URL = 'http://localhost:8117';
process.env.INTEXURAOS_ACTIONS_AGENT_URL = 'http://localhost:8118';
process.env.INTEXURAOS_DATA_INSIGHTS_AGENT_URL = 'http://localhost:8119';
process.env.INTEXURAOS_NOTES_AGENT_URL = 'http://localhost:8121';
process.env.INTEXURAOS_TODOS_AGENT_URL = 'http://localhost:8123';
process.env.INTEXURAOS_BOOKMARKS_AGENT_URL = 'http://localhost:8124';
process.env.INTEXURAOS_CALENDAR_AGENT_URL = 'http://localhost:8125';
process.env.INTEXURAOS_LINEAR_AGENT_URL = 'http://localhost:8126';
process.env.INTEXURAOS_CODE_AGENT_URL = 'http://localhost:8128';
process.env.INTEXURAOS_CHAT_AGENT_URL = 'http://localhost:8129';
process.env.INTEXURAOS_APP_SETTINGS_SERVICE_URL = 'http://localhost:8122';
process.env.INTEXURAOS_FIREBASE_PROJECT_ID = 'test-project';
process.env.INTEXURAOS_FIREBASE_API_KEY = 'test-key';
process.env.INTEXURAOS_FIREBASE_AUTH_DOMAIN = 'test.firebaseapp.com';
process.env.INTEXURAOS_SENTRY_DSN_WEB = 'test-dsn';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: false,
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.ts', 'src/**/__tests__/**/*.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/__tests__/setup.ts'],
    setupFiles: ['./src/__tests__/setup.ts'],
    typecheck: {
      enabled: false,
    },
    testTimeout: 10000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportOnFailure: true,
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/*.spec.tsx',
        '**/__tests__/**',
        '**/index.ts',
        '**/vite-env.d.ts',
      ],
    },
  },
});
