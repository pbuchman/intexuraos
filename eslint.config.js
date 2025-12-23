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
          allowDefaultProject: ['*.config.ts', '*.config.js'],
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
      'boundaries/elements': [
        { type: 'common', pattern: ['packages/common/src/**'] },
        { type: 'apps', pattern: ['apps/*/src/**'] },
      ],
      'boundaries/ignore': ['**/*.test.ts', '**/*.spec.ts'],
    },
    rules: {
      'boundaries/no-unknown': ['error'],
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // common can only import from common
            { from: 'common', allow: ['common'] },
            // apps can import from common (apps own their domain and infra)
            { from: 'apps', allow: ['common', 'apps'] },
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
              group: ['@praxos/*/src/*', '@praxos/*/src/**'],
              message:
                'Deep imports into package internals are forbidden. Import from the package entrypoint instead.',
            },
            {
              group: ['@praxos/auth-service', '@praxos/auth-service/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@praxos/promptvault-service', '@praxos/promptvault-service/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@praxos/notion-service', '@praxos/notion-service/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@praxos/whatsapp-service', '@praxos/whatsapp-service/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@praxos/api-docs-hub', '@praxos/api-docs-hub/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@praxos/web', '@praxos/web/**'],
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
    ],
  }
);
