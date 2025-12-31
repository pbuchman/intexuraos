import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
export default tseslint.config(
  // Global ignores - must be first
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      'docker/**',
      'scripts/**',
      'vitest.setup.ts',
      'vitest.config.ts',
      '**/__tests__/**',
      '**/*.test.ts',
      '**/*.spec.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
  },
  {
    plugins: {
      boundaries,
    },
    settings: {
      'boundaries/include': ['apps/*/src/**', 'packages/*/src/**'],
      'boundaries/elements': [
        { type: 'http-contracts', pattern: ['packages/http-contracts/src/**'], mode: 'folder' },
        { type: 'common-core', pattern: ['packages/common-core/src/**'], mode: 'folder' },
        { type: 'common-http', pattern: ['packages/common-http/src/**'], mode: 'folder' },
        { type: 'infra-firestore', pattern: ['packages/infra-firestore/src/**'], mode: 'folder' },
        { type: 'infra-notion', pattern: ['packages/infra-notion/src/**'], mode: 'folder' },
        { type: 'infra-whatsapp', pattern: ['packages/infra-whatsapp/src/**'], mode: 'folder' },
        { type: 'infra-gemini', pattern: ['packages/infra-gemini/src/**'], mode: 'folder' },
        { type: 'infra-claude', pattern: ['packages/infra-claude/src/**'], mode: 'folder' },
        { type: 'infra-gpt', pattern: ['packages/infra-gpt/src/**'], mode: 'folder' },
        { type: 'infra-llm-audit', pattern: ['packages/infra-llm-audit/src/**'], mode: 'folder' },
        { type: 'http-server', pattern: ['packages/http-server/src/**'], mode: 'folder' },
        { type: 'apps', pattern: ['apps/*/src/**'], mode: 'folder' },
      ],
      'boundaries/ignore': ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // http-contracts is a leaf package (no dependencies)
            { from: 'http-contracts', allow: ['http-contracts'] },
            // common-core is a leaf package (no dependencies)
            { from: 'common-core', allow: ['common-core'] },
            // common-http can import from common-core
            { from: 'common-http', allow: ['common-http', 'common-core'] },
            // infra-firestore can import from common-core
            { from: 'infra-firestore', allow: ['infra-firestore', 'common-core'] },
            // infra-notion can import from common-core and infra-firestore
            { from: 'infra-notion', allow: ['infra-notion', 'common-core', 'infra-firestore'] },
            // infra-whatsapp can import from common-core
            { from: 'infra-whatsapp', allow: ['infra-whatsapp', 'common-core'] },
            // infra-gemini can import from common-core and infra-llm-audit
            { from: 'infra-gemini', allow: ['infra-gemini', 'common-core', 'infra-llm-audit'] },
            // infra-claude can import from common-core and infra-llm-audit
            { from: 'infra-claude', allow: ['infra-claude', 'common-core', 'infra-llm-audit'] },
            // infra-gpt can import from common-core and infra-llm-audit
            { from: 'infra-gpt', allow: ['infra-gpt', 'common-core', 'infra-llm-audit'] },
            // infra-llm-audit can import from common-core and infra-firestore
            {
              from: 'infra-llm-audit',
              allow: ['infra-llm-audit', 'common-core', 'infra-firestore'],
            },
            // http-server can import from decomposed packages
            {
              from: 'http-server',
              allow: [
                'http-server',
                'common-core',
                'common-http',
                'infra-firestore',
                'infra-notion',
              ],
            },
            // apps can import from all packages
            {
              from: 'apps',
              allow: [
                'common-core',
                'common-http',
                'infra-firestore',
                'infra-notion',
                'infra-whatsapp',
                'infra-gemini',
                'infra-claude',
                'infra-gpt',
                'infra-llm-audit',
                'http-contracts',
                'http-server',
                'apps',
              ],
            },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // Disable this rule - it conflicts with no-non-null-assertion
      // It suggests using ! but ! is forbidden by no-non-null-assertion
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      'no-console': 'error',
      'no-debugger': 'error',
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-return-await': 'off',
      '@typescript-eslint/return-await': ['error', 'always'],
      // Block deep imports into other packages' /src/ directories
      // Cross-package imports should use the public entrypoint (index.ts)
      // Also block cross-app imports (apps should not import from other apps)
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@intexuraos/*/src/*', '@intexuraos/*/src/**'],
              message:
                'Deep imports into package internals are forbidden. Import from the package entrypoint instead.',
            },
            // Pattern-based cross-app isolation:
            // Block all *-service apps, web app, and api-docs-hub automatically
            // New apps following naming convention are blocked without config changes
            {
              group: ['@intexuraos/*-service', '@intexuraos/*-service/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/web', '@intexuraos/web/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/api-docs-hub', '@intexuraos/api-docs-hub/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/commands-router', '@intexuraos/commands-router/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
          ],
        },
      ],
    },
  },
  // Apps must use @intexuraos/infra-firestore singleton, not direct Firestore import
  {
    files: ['apps/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@google-cloud/firestore',
              message:
                'Use @intexuraos/infra-firestore singleton (getFirestore()) instead of importing Firestore directly.',
            },
          ],
          patterns: [
            {
              group: ['@intexuraos/*/src/*', '@intexuraos/*/src/**'],
              message:
                'Deep imports into package internals are forbidden. Import from the package entrypoint instead.',
            },
            {
              group: ['@intexuraos/*-service', '@intexuraos/*-service/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/web', '@intexuraos/web/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/api-docs-hub', '@intexuraos/api-docs-hub/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/commands-router', '@intexuraos/commands-router/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
          ],
        },
      ],
    },
  },
  // CRITICAL #1: Routes layer must not import infra packages directly (bypasses domain/DI)
  // Routes should get dependencies via getServices(), not instantiate infra directly
  {
    files: ['apps/*/src/routes/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@google-cloud/firestore',
              message:
                'Use @intexuraos/infra-firestore singleton (getFirestore()) instead of importing Firestore directly.',
            },
            {
              name: '@intexuraos/infra-gemini',
              message:
                'Routes must not import infra packages directly. Use getServices() to access LLM clients via dependency injection.',
            },
            {
              name: '@intexuraos/infra-gpt',
              message:
                'Routes must not import infra packages directly. Use getServices() to access LLM clients via dependency injection.',
            },
            {
              name: '@intexuraos/infra-claude',
              message:
                'Routes must not import infra packages directly. Use getServices() to access LLM clients via dependency injection.',
            },
            {
              name: '@intexuraos/infra-whatsapp',
              message:
                'Routes must not import infra packages directly. Use getServices() to access WhatsApp client via dependency injection.',
            },
            {
              name: '@intexuraos/infra-notion',
              message:
                'Routes must not import infra packages directly. Use getServices() to access Notion client via dependency injection.',
            },
          ],
          patterns: [
            {
              group: ['@intexuraos/*/src/*', '@intexuraos/*/src/**'],
              message:
                'Deep imports into package internals are forbidden. Import from the package entrypoint instead.',
            },
            {
              group: ['@intexuraos/*-service', '@intexuraos/*-service/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/web', '@intexuraos/web/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/api-docs-hub', '@intexuraos/api-docs-hub/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/commands-router', '@intexuraos/commands-router/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
          ],
        },
      ],
    },
  },
  // CRITICAL #2: Infra layer must not import from routes layer (inverted dependency)
  // Dependency direction: Routes → Domain → Infra (never Infra → Routes)
  {
    files: ['apps/*/src/infra/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@google-cloud/firestore',
              message:
                'Use @intexuraos/infra-firestore singleton (getFirestore()) instead of importing Firestore directly.',
            },
          ],
          patterns: [
            {
              group: [
                '*/routes/*',
                '*/routes/**',
                '../routes/*',
                '../routes/**',
                '../../routes/*',
                '../../routes/**',
              ],
              message:
                'Infra layer must not import from routes layer. Move shared code to domain or a common utility.',
            },
            {
              group: ['@intexuraos/*/src/*', '@intexuraos/*/src/**'],
              message:
                'Deep imports into package internals are forbidden. Import from the package entrypoint instead.',
            },
            {
              group: ['@intexuraos/*-service', '@intexuraos/*-service/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/web', '@intexuraos/web/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/api-docs-hub', '@intexuraos/api-docs-hub/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/commands-router', '@intexuraos/commands-router/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['*.config.ts', '*.config.js'],
    rules: {
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  }
);
