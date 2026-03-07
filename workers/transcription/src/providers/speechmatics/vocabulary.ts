/**
 * Custom vocabulary for Speechmatics transcription.
 *
 * Includes IntexuraOS brand terms, development tools, agent names,
 * cloud platforms, and Polish-English code-mixed terms.
 */

export const ADDITIONAL_VOCAB = [
  // Brand terms
  {
    content: 'IntexuraOS',
    sounds_like: ['in tex ura o s', 'in tech sura o s', 'inteksura os', 'in texture os'],
  },
  { content: 'pbuchman', sounds_like: ['p buck man', 'p book man', 'piotr buchman'] },

  // Development tools
  { content: 'pnpm', sounds_like: ['p n p m', 'pin pm', 'pee en pee em', 'performant npm'] },
  { content: 'tf', sounds_like: ['tea eff', 'terraform'] },
  { content: 'gh', sounds_like: ['gee aitch', 'git hub'] },
  { content: 'ci:tracked', sounds_like: ['see eye tracked', 'c i tracked'] },
  { content: 'monorepo', sounds_like: ['mono repo', 'mono reap oh'] },
  { content: 'worktree', sounds_like: ['work tree'] },

  // Service agents
  { content: 'service-scribe', sounds_like: ['service scribe'] },
  { content: 'coverage-orchestrator', sounds_like: ['coverage orchestrator'] },
  { content: 'actions-agent', sounds_like: ['actions agent'] },
  { content: 'research-agent', sounds_like: ['research agent'] },
  { content: 'commands-agent', sounds_like: ['commands agent'] },
  { content: 'data-insights-agent', sounds_like: ['data insights agent'] },
  { content: 'bookmarks-agent', sounds_like: ['bookmarks agent'] },
  { content: 'todos-agent', sounds_like: ['to dos agent', 'todos agent'] },
  { content: 'web-agent', sounds_like: ['web agent'] },
  { content: 'calendar-agent', sounds_like: ['calendar agent'] },
  { content: 'linear-agent', sounds_like: ['linear agent'] },
  { content: 'notes-agent', sounds_like: ['notes agent'] },
  { content: 'user-service', sounds_like: ['user service'] },
  { content: 'whatsapp-service', sounds_like: ['whatsapp service', 'what sap service'] },
  { content: 'notion-service', sounds_like: ['notion service'] },
  { content: 'image-service', sounds_like: ['image service'] },

  // AI/LLM providers and models
  { content: 'z.ai', sounds_like: ['zed dot a i', 'zee dot a i', 'zai', 'the ai'] },
  { content: 'GLM-4.7', sounds_like: ['gee el em four point seven'] },
  { content: 'Claude Opus', sounds_like: ['cloud opus', 'claude opus'] },
  { content: 'Claude Sonnet', sounds_like: ['cloud sonnet', 'claude sonnet'] },
  { content: 'Gemini', sounds_like: ['gem in eye', 'gem ini'] },
  { content: 'OpenAI', sounds_like: ['open a i', 'open ai'] },
  { content: 'Anthropic', sounds_like: ['an throw pick', 'an throp ik'] },
  { content: 'Perplexity', sounds_like: ['per plex ity'] },
  { content: 'Perplexity Sonar', sounds_like: ['perplexity sonar'] },
  { content: 'LMS', sounds_like: ['el em ess', 'learning management system'] },
  {
    content: 'LLM',
    sounds_like: [
      'el el em',
      'elle em',
      'large language model',
      'ell ell em',
      'double l m',
      'ell l m',
    ],
  },
  {
    content: 'LLMs',
    sounds_like: [
      'el el ems',
      'elle ems',
      'large language models',
      'ell ell ems',
      'double l ms',
      'ell l ms',
    ],
  },
  {
    content: 'large language model',
    sounds_like: ['large lang model', 'large language model', 'large lang models'],
  },
  {
    content: 'large language models',
    sounds_like: ['large lang models', 'large language models', 'large lang model'],
  },

  // Platform tools and services
  { content: 'Linear', sounds_like: ['line ear', 'linear app', 'lin ear', 'linear', 'leener'] },
  { content: 'Sentry', sounds_like: ['sentry', 'century'] },
  { content: 'Auth0', sounds_like: ['auth zero', 'oauth'] },
  { content: 'OAuth', sounds_like: ['oh auth', 'o auth'] },
  { content: 'Notion', sounds_like: ['no shun', 'notion'] },
  { content: 'WhatsApp', sounds_like: ['whats app', 'what sap'] },
  { content: 'Firestore', sounds_like: ['fire store'] },
  { content: 'Pub/Sub', sounds_like: ['pub sub', 'publish subscribe'] },
  { content: 'pubsub', sounds_like: ['pub sub'] },
  { content: 'Vite', sounds_like: ['veet', 'vight'] },
  { content: 'Vitest', sounds_like: ['veet test', 'vight test'] },
  { content: 'Fastify', sounds_like: ['fast if i'] },
  { content: 'Bun', sounds_like: ['bun', 'bunn'] },
  { content: 'Bunx', sounds_like: ['bun x', 'bunks'] },
  { content: 'Speechmatics', sounds_like: ['speech matics'] },
  { content: 'Zod', sounds_like: ['zod', 'zodd'] },

  // Cloud/DevOps
  { content: 'GCP', sounds_like: ['gee see pee', 'g c p'] },
  { content: 'GCS', sounds_like: ['gee see ess', 'g c s'] },
  { content: 'WABA', sounds_like: ['wah bah', 'w a b a'] },
  { content: 'SemVer', sounds_like: ['sem ver', 'semantic versioning'] },
  { content: 'JWKS', sounds_like: ['jay double you kay ess', 'j w k s'] },
  { content: 'Cloud Run', sounds_like: ['cloud run'] },
  { content: 'Cloud Build', sounds_like: ['cloud build'] },
  { content: 'cloudbuild', sounds_like: ['cloud build'] },
  { content: 'Workload Identity', sounds_like: ['workload identity'] },
  { content: 'Kanban', sounds_like: ['can ban', 'kahn bahn'] },
  { content: 'TDD', sounds_like: ['tee dee dee'] },
  { content: 'api-docs-hub', sounds_like: ['api docs hub'] },
  { content: 'smart-dispatch', sounds_like: ['smart dispatch'] },
  { content: 'Terraform', sounds_like: ['terra form'] },
  { content: 'emulator', sounds_like: ['em you lay tor'] },
  { content: 'webhook', sounds_like: ['web hook'] },
  { content: 'PWA', sounds_like: ['pee double you ay', 'p w a'] },

  // Architecture terms
  { content: 'usecase', sounds_like: ['use case'] },
  { content: 'infra', sounds_like: ['in fra', 'infrastructure'] },
  { content: 'dto', sounds_like: ['dee tee oh', 'd t o'] },
  { content: 'compositeIndex', sounds_like: ['composite index'] },
  { content: 'barrel export', sounds_like: ['barrel export'] },

  // Common dev terms
  { content: 'scaffolded', sounds_like: ['scaffold it', 'ska folded'] },
  { content: 'delikatny', sounds_like: ['deli cat ny'] },
  { content: 'enhance', sounds_like: ['en hance'] },
  { content: 'enhancement', sounds_like: ['en hance ment'] },

  // Polish terms commonly used in mixed context
  { content: 'wygaszać', sounds_like: ['vi ga shatch', 've ga shatch'] },
  { content: 'zaakceptujemy', sounds_like: ['za ak cep tu ye my', 'zah ak cep tu jemy'] },
  { content: 'kliknięcia', sounds_like: ['click nien cia', 'klik nien cia'] },
  { content: 'kontenerze', sounds_like: ['con ten er zhe', 'kontenerze'] },
  { content: 'sprawdzenie', sounds_like: ['sprav dze nie'] },
  { content: 'zapasów', sounds_like: ['za pa soof', 'zapasuv'] },
  { content: 'grupować', sounds_like: ['group o vatch'] },

  // Polish-English code-mixed verbs (Polish suffix on English root)
  { content: 'commitować', sounds_like: ['commit o vatch'] },
  { content: "merge'ować", sounds_like: ['merge o vatch'] },
  { content: 'pushować', sounds_like: ['push o vatch'] },
];
