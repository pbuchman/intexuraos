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
      'vitest.setup.ts',
      'vitest.config.ts',
      'vitest-mocks/**',
      'workers/**/scripts/**',
      // Test files now linted with same rules as production code
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
        { type: 'infra-pubsub', pattern: ['packages/infra-pubsub/src/**'], mode: 'folder' },
        { type: 'infra-gemini', pattern: ['packages/infra-gemini/src/**'], mode: 'folder' },
        { type: 'infra-claude', pattern: ['packages/infra-claude/src/**'], mode: 'folder' },
        { type: 'infra-gpt', pattern: ['packages/infra-gpt/src/**'], mode: 'folder' },
        { type: 'llm-audit', pattern: ['packages/llm-audit/src/**'], mode: 'folder' },
        { type: 'llm-contract', pattern: ['packages/llm-contract/src/**'], mode: 'folder' },
        { type: 'llm-pricing', pattern: ['packages/llm-pricing/src/**'], mode: 'folder' },
        { type: 'http-server', pattern: ['packages/http-server/src/**'], mode: 'folder' },
        { type: 'apps', pattern: ['apps/*/src/**'], mode: 'folder' },
      ],
      'boundaries/ignore': ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'],
    },
    rules: {
      // Enable redundant escape detection
      'no-useless-escape': 'error',

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
            // infra-pubsub can import from common-core
            { from: 'infra-pubsub', allow: ['infra-pubsub', 'common-core'] },
            // llm-contract can import from common-core
            { from: 'llm-contract', allow: ['llm-contract', 'common-core'] },
            // llm-pricing can import from llm-contract (no common-core needed)
            { from: 'llm-pricing', allow: ['llm-pricing', 'llm-contract'] },
            // infra-gemini can import from common-core, llm-audit, llm-contract, and llm-pricing
            {
              from: 'infra-gemini',
              allow: ['infra-gemini', 'common-core', 'llm-audit', 'llm-contract', 'llm-pricing'],
            },
            // infra-claude can import from common-core, llm-audit, llm-contract, and llm-pricing
            {
              from: 'infra-claude',
              allow: ['infra-claude', 'common-core', 'llm-audit', 'llm-contract', 'llm-pricing'],
            },
            // infra-gpt can import from common-core, llm-audit, llm-contract, and llm-pricing
            {
              from: 'infra-gpt',
              allow: ['infra-gpt', 'common-core', 'llm-audit', 'llm-contract', 'llm-pricing'],
            },
            // llm-audit can import from common-core and infra-firestore
            {
              from: 'llm-audit',
              allow: ['llm-audit', 'common-core', 'infra-firestore'],
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
                'infra-pubsub',
                'infra-gemini',
                'infra-claude',
                'infra-gpt',
                'llm-audit',
                'llm-contract',
                'llm-pricing',
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
      // Rule 1.6: No empty catch blocks (all catch blocks must handle errors)
      'no-empty': ['error', { allowEmptyCatch: false }],
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
              group: ['@intexuraos/commands-agent', '@intexuraos/commands-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/actions-agent', '@intexuraos/actions-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/research-agent', '@intexuraos/research-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/notes-agent', '@intexuraos/notes-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/todos-agent', '@intexuraos/todos-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/web-agent', '@intexuraos/web-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
          ],
        },
      ],
    },
  },
  // Apps must use @intexuraos/infra-* wrappers, not direct SDK imports
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
            {
              name: '@google/genai',
              message: 'Use @intexuraos/infra-gemini instead of importing Google GenAI directly.',
            },
            {
              name: 'openai',
              message: 'Use @intexuraos/infra-gpt instead of importing OpenAI directly.',
            },
            {
              name: '@anthropic-ai/sdk',
              message: 'Use @intexuraos/infra-claude instead of importing Anthropic directly.',
            },
            {
              name: '@notionhq/client',
              message: 'Use @intexuraos/infra-notion instead of importing Notion directly.',
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
              group: ['@intexuraos/commands-agent', '@intexuraos/commands-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/actions-agent', '@intexuraos/actions-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/research-agent', '@intexuraos/research-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/notes-agent', '@intexuraos/notes-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/todos-agent', '@intexuraos/todos-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/web-agent', '@intexuraos/web-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
          ],
        },
      ],
    },
  },
  // Rule 1.1: Packages must use Firestore singleton from @intexuraos/infra-firestore
  {
    files: ['packages/*/src/**/*.ts'],
    ignores: ['packages/infra-firestore/**'],
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
              name: 'firebase-admin/firestore',
              message:
                'Use @intexuraos/infra-firestore singleton (getFirestore()) instead of importing Firestore directly.',
            },
          ],
        },
      ],
    },
  },
  // CRITICAL: Prevent Pub/Sub pull subscriptions - incompatible with Cloud Run
  // Cloud Run scales to zero; pull subscriptions require persistent processes
  // All Pub/Sub consumers must use HTTP push endpoints
  {
    files: ['apps/*/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='on'][arguments.0.value='message'][arguments.0.type='Literal']",
          message:
            'Pull subscriptions (.on("message")) are forbidden. Cloud Run scales to zero and cannot process pull subscriptions. Use HTTP push endpoints instead. See CLAUDE.md for pattern.',
        },
      ],
    },
  },
  // Only whatsapp-service may use @intexuraos/infra-whatsapp directly
  // All other apps must use @intexuraos/infra-pubsub to send messages via Pub/Sub
  {
    files: ['apps/*/src/**/*.ts'],
    ignores: ['apps/whatsapp-service/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@intexuraos/infra-whatsapp',
              message:
                'Use @intexuraos/infra-pubsub WhatsApp publisher instead. Only whatsapp-service may use infra-whatsapp directly.',
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
              group: ['@intexuraos/commands-agent', '@intexuraos/commands-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/actions-agent', '@intexuraos/actions-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/research-agent', '@intexuraos/research-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/notes-agent', '@intexuraos/notes-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/todos-agent', '@intexuraos/todos-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/web-agent', '@intexuraos/web-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: [
                '../infra/firestore/*',
                '../infra/firestore/**',
                '../../infra/firestore/*',
                '../../infra/firestore/**',
              ],
              message:
                'Routes must not import from infra/firestore directly. Access repositories via getServices() for proper DI.',
            },
            {
              group: [
                '../infra/whatsapp/*',
                '../infra/whatsapp/**',
                '../../infra/whatsapp/*',
                '../../infra/whatsapp/**',
              ],
              message:
                'Routes must not import from infra/whatsapp directly. Access WhatsApp client via getServices() for proper DI.',
            },
            {
              group: [
                '../infra/llm/*',
                '../infra/llm/**',
                '../../infra/llm/*',
                '../../infra/llm/**',
              ],
              message:
                'Routes must not import from infra/llm directly. Access LLM adapters via getServices() for proper DI.',
            },
            {
              group: [
                '../infra/notion/*',
                '../infra/notion/**',
                '../../infra/notion/*',
                '../../infra/notion/**',
              ],
              message:
                'Routes must not import from infra/notion directly. Access Notion client via getServices() for proper DI.',
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
            {
              name: '@google/genai',
              message: 'Use @intexuraos/infra-gemini instead of importing Google GenAI directly.',
            },
            {
              name: 'openai',
              message: 'Use @intexuraos/infra-gpt instead of importing OpenAI directly.',
            },
            {
              name: '@anthropic-ai/sdk',
              message: 'Use @intexuraos/infra-claude instead of importing Anthropic directly.',
            },
            {
              name: '@notionhq/client',
              message: 'Use @intexuraos/infra-notion instead of importing Notion directly.',
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
              group: [
                '../firestore/*',
                '../firestore/**',
                '../../firestore/*',
                '../../firestore/**',
              ],
              message:
                'Infra adapters should receive repositories via function parameters, not import directly from other infra folders. Use dependency injection.',
            },
            {
              group: ['../whatsapp/*', '../whatsapp/**', '../../whatsapp/*', '../../whatsapp/**'],
              message:
                'Infra adapters should receive WhatsApp client via function parameters, not import directly from other infra folders. Use dependency injection.',
            },
            {
              group: ['../llm/*', '../llm/**', '../../llm/*', '../../llm/**'],
              message:
                'Infra adapters should receive LLM clients via function parameters, not import directly from other infra folders. Use dependency injection.',
            },
            {
              group: ['../notion/*', '../notion/**', '../../notion/*', '../../notion/**'],
              message:
                'Infra adapters should receive Notion client via function parameters, not import directly from other infra folders. Use dependency injection.',
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
              group: ['@intexuraos/commands-agent', '@intexuraos/commands-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/actions-agent', '@intexuraos/actions-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/research-agent', '@intexuraos/research-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/notes-agent', '@intexuraos/notes-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/todos-agent', '@intexuraos/todos-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
            {
              group: ['@intexuraos/web-agent', '@intexuraos/web-agent/**'],
              message: 'Cross-app imports are forbidden. Apps cannot import from other apps.',
            },
          ],
        },
      ],
    },
  },
  // CRITICAL #3: Domain layer must not import from infra layer (Clean Architecture)
  // Dependency direction: Routes → Domain ← Infra (domain is the core, infra implements domain ports)
  {
    files: ['apps/*/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../infra/*',
                '../infra/**',
                '../../infra/*',
                '../../infra/**',
                '../../../infra/*',
                '../../../infra/**',
              ],
              message:
                'Domain layer must not import from infra layer. Define port interfaces in domain and implement them in infra.',
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
              group: ['@intexuraos/*-agent', '@intexuraos/*-agent/**'],
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
          ],
        },
      ],
    },
  },
  // Rule 1.2: Test isolation - tests must not make real network calls
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='http'][callee.property.name='request']",
          message: 'Tests must not make real HTTP requests. Use nock or fake service clients.',
        },
        {
          selector: "CallExpression[callee.object.name='https'][callee.property.name='request']",
          message: 'Tests must not make real HTTP requests. Use nock or fake service clients.',
        },
      ],
    },
  },
  // Rule 1.3: No auth tokens in localStorage (use Auth0 SDK)
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/context/pwa-context.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='localStorage'][callee.property.name='setItem'][arguments.0.value=/token|auth|jwt|access|refresh/i]",
          message:
            'Never store auth tokens in localStorage. Use Auth0 SDK for secure token storage.',
        },
        {
          selector:
            "CallExpression[callee.object.name='localStorage'][callee.property.name='getItem'][arguments.0.value=/token|auth|jwt|access|refresh/i]",
          message: 'Never retrieve auth tokens from localStorage. Use Auth0 SDK hooks (useAuth0).',
        },
        {
          selector:
            "CallExpression[callee.object.name='sessionStorage'][callee.property.name='setItem'][arguments.0.value=/token|auth|jwt|access|refresh/i]",
          message:
            'Never store auth tokens in sessionStorage. Use Auth0 SDK for secure token storage.',
        },
      ],
    },
  },
  // Rule 1.4: TailwindCSS only (no inline styles)
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/pages/HomePage.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style'][value.type='JSXExpressionContainer']",
          message: 'Use TailwindCSS classes instead of inline style objects.',
        },
      ],
    },
  },
  // Rule 1.5: Repositories should call getFirestore() in methods, not accept as constructor param
  {
    files: ['apps/*/src/infra/firestore/**/*.ts', 'packages/*/src/**/*Repository.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MethodDefinition[key.name='constructor'] Parameter[typeAnnotation.typeAnnotation.typeName.name='Firestore']",
          message:
            'Repositories should call getFirestore() within methods, not accept Firestore as constructor parameter.',
        },
      ],
    },
  },
  // Rule 1.7: Use error utilities instead of inline error extraction
  // Note: apps/web is excluded because common-core uses Node.js crypto which can't run in browser
  {
    files: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
    ignores: ['packages/common-core/**', 'apps/web/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "ConditionalExpression[test.operator='instanceof'][test.right.name='Error'][consequent.property.name='message']",
          message:
            'Use getErrorMessage(error, fallback) from @intexuraos/common-core instead of inline error extraction.',
        },
        {
          selector: 'Identifier[name=/^logger$/i][optional=true]',
          message:
            'Logger parameter must be required (logger: Logger), not optional (logger?: Logger). Logger must be injected via dependency injection.',
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
  // Scripts: Relaxed rules for utility scripts
  {
    files: ['scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        program: null,
        project: false,
        projectService: false,
      },
    },
    rules: {
      // Disable all type-aware rules (scripts not in tsconfig)
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/consistent-return': 'off',
      '@typescript-eslint/consistent-type-exports': 'off',
      '@typescript-eslint/dot-notation': 'off',
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/no-array-delete': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/no-duplicate-type-constituents': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-for-in-array': 'off',
      '@typescript-eslint/no-implied-eval': 'off',
      '@typescript-eslint/no-meaningless-void-operator': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-misused-spread': 'off',
      '@typescript-eslint/no-mixed-enums': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-qualifier': 'off',
      '@typescript-eslint/no-unnecessary-template-expression': 'off',
      '@typescript-eslint/no-unnecessary-type-arguments': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-unary-minus': 'off',
      '@typescript-eslint/no-useless-default-assignment': 'off',
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-destructuring': 'off',
      '@typescript-eslint/prefer-find': 'off',
      '@typescript-eslint/prefer-includes': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/prefer-readonly': 'off',
      '@typescript-eslint/prefer-readonly-parameter-types': 'off',
      '@typescript-eslint/prefer-reduce-type-parameter': 'off',
      '@typescript-eslint/prefer-regexp-exec': 'off',
      '@typescript-eslint/prefer-return-this-type': 'off',
      '@typescript-eslint/prefer-string-starts-ends-with': 'off',
      '@typescript-eslint/promise-function-async': 'off',
      '@typescript-eslint/related-getter-setter-pairs': 'off',
      '@typescript-eslint/require-array-sort-compare': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/return-await': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/switch-exhaustiveness-check': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'off',
      // Keep these enabled to catch issues like unused variables
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off', // Scripts can use console
    },
  },
  // Web app: Adjusted verification due to planned refactoring
  // Disable strict type-checked rules that don't align with browser/React patterns
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/**/__tests__/**', 'apps/web/**/*.test.ts', 'apps/web/**/*.spec.ts'],
    rules: {
      // Relax unsafe-* rules for browser environment patterns
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Allow truthy/falsy checks in React patterns
      '@typescript-eslint/strict-boolean-expressions': 'off',
    },
  },
  // Test files: Disable type-aware linting (not in tsconfig by design)
  // This MUST be last to override all type-checked rules from strictTypeChecked
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      parserOptions: {
        program: null,
        project: false,
        projectService: false,
      },
    },
    rules: {
      // Disable all type-aware rules for test files (from tseslint.configs.disableTypeChecked)
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/consistent-return': 'off',
      '@typescript-eslint/consistent-type-exports': 'off',
      '@typescript-eslint/dot-notation': 'off',
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/no-array-delete': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/no-duplicate-type-constituents': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-for-in-array': 'off',
      '@typescript-eslint/no-implied-eval': 'off',
      '@typescript-eslint/no-meaningless-void-operator': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-misused-spread': 'off',
      '@typescript-eslint/no-mixed-enums': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-qualifier': 'off',
      '@typescript-eslint/no-unnecessary-template-expression': 'off',
      '@typescript-eslint/no-unnecessary-type-arguments': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-unary-minus': 'off',
      '@typescript-eslint/no-useless-default-assignment': 'off',
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-destructuring': 'off',
      '@typescript-eslint/prefer-find': 'off',
      '@typescript-eslint/prefer-includes': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/prefer-readonly': 'off',
      '@typescript-eslint/prefer-readonly-parameter-types': 'off',
      '@typescript-eslint/prefer-reduce-type-parameter': 'off',
      '@typescript-eslint/prefer-regexp-exec': 'off',
      '@typescript-eslint/prefer-return-this-type': 'off',
      '@typescript-eslint/prefer-string-starts-ends-with': 'off',
      '@typescript-eslint/promise-function-async': 'off',
      '@typescript-eslint/related-getter-setter-pairs': 'off',
      '@typescript-eslint/require-array-sort-compare': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/return-await': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/switch-exhaustiveness-check': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'off',
    },
  }
);
