import { mergeConfig, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedConfig } from '../../vitest.shared.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set up environment variables for tests
process.env.INTEXURAOS_AUTH0_DOMAIN = 'test-domain';
process.env.INTEXURAOS_AUTH0_SPA_CLIENT_ID = 'test-client-id';
process.env.INTEXURAOS_AUTH_AUDIENCE = 'test-audience';
process.env.INTEXURAOS_USER_SERVICE_URL = 'http://localhost:8110';
process.env.INTEXURAOS_WHATSAPP_SERVICE_URL = 'http://localhost:8113';
process.env.INTEXURAOS_NOTION_SERVICE_URL = 'http://localhost:8112';
process.env.INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL = 'http://localhost:8114';
process.env.INTEXURAOS_FISHING_ASSISTANT_SERVICE_URL = 'http://localhost:8115';
process.env.INTEXURAOS_RESEARCH_AGENT_URL = 'http://localhost:8116';
process.env.INTEXURAOS_COMMANDS_AGENT_URL = 'http://localhost:8117';
process.env.INTEXURAOS_ACTIONS_AGENT_URL = 'http://localhost:8118';
process.env.INTEXURAOS_NOTES_AGENT_URL = 'http://localhost:8121';
process.env.INTEXURAOS_BOOKMARKS_AGENT_URL = 'http://localhost:8124';
process.env.INTEXURAOS_CALENDAR_AGENT_URL = 'http://localhost:8125';
process.env.INTEXURAOS_LINEAR_AGENT_URL = 'http://localhost:8126';
process.env.INTEXURAOS_CODE_AGENT_URL = 'http://localhost:8128';
process.env.INTEXURAOS_APP_SETTINGS_SERVICE_URL = 'http://localhost:8122';
process.env.INTEXURAOS_HELLSCRIPT_AGENT_URL = 'http://localhost:8131';
process.env.INTEXURAOS_LLM_USAGE_SERVICE_URL = 'http://localhost:8132';
process.env.INTEXURAOS_IMAGE_SERVICE_URL = 'http://localhost:8120';
process.env.INTEXURAOS_WEB_AGENT_URL = 'http://localhost:8127';
process.env.INTEXURAOS_FIREBASE_PROJECT_ID = 'test-project';
process.env.INTEXURAOS_FIREBASE_API_KEY = 'test-key';
process.env.INTEXURAOS_FIREBASE_AUTH_DOMAIN = 'test.firebaseapp.com';
process.env.INTEXURAOS_SENTRY_DSN_WEB = 'test-dsn';

// Web inherits the shared base (alias for @notionhq/client + the global
// vitest.setup.ts mocks) and adds React/jsdom-specific config.
//
// Coverage thresholds are intentionally cleared (web is the documented
// UI-coverage exception per CLAUDE.md): UI tests are optional, only
// utils/services/hooks need coverage. mergeConfig concatenates setupFiles,
// so the web-specific setup runs alongside the global one.
export default mergeConfig(
  sharedConfig,
  defineConfig({
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        // Mock virtual:pwa-register for tests
        'virtual:pwa-register': resolve(
          __dirname,
          'src/__tests__/__mocks__/virtual-pwa-register.ts'
        ),
      },
    },
    test: {
      globals: false,
      environment: 'jsdom',
      include: ['src/**/__tests__/**/*.ts', 'src/**/__tests__/**/*.tsx'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/__tests__/setup.ts',
        '**/__tests__/__mocks__/**',
      ],
      // setupFiles is INTENTIONALLY appended (mergeConfig concatenates arrays);
      // both the global mocks and the web-specific jsdom matchers run.
      setupFiles: ['./src/__tests__/setup.ts'],
      typecheck: {
        enabled: false,
      },
      coverage: {
        // provider/reporter inherited from sharedConfig
        // CLAUDE.md exception: UI coverage is not enforced — clear the 95% thresholds.
        thresholds: {},
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
  })
);
