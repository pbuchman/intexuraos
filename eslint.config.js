import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.config.ts', '*.config.js', 'vitest.setup.ts'],
        },
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
        { type: 'common', pattern: ['packages/common/src/**'], mode: 'folder' },
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
            // common can only import from common
            { from: 'common', allow: ['common'] },
            // http-server can import from common
            { from: 'http-server', allow: ['http-server', 'common'] },
            // apps can import from all packages
            { from: 'apps', allow: ['common', 'http-contracts', 'http-server', 'apps'] },
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
            {
              group: ['@intexuraos/auth-service', '@intexuraos/auth-service/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/promptvault-service', '@intexuraos/promptvault-service/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/notion-service', '@intexuraos/notion-service/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/whatsapp-service', '@intexuraos/whatsapp-service/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/api-docs-hub', '@intexuraos/api-docs-hub/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/web', '@intexuraos/web/**'],
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
  },
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
    ],
  }
);
