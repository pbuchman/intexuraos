# Fishing Assistant RAG Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` only when the harness and user explicitly authorize subagents; otherwise use `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-user Fishing Assistant with Knowledge Base CRUD, persisted chat, Gemini 3 Flash RAG answers, and strict citations from Knowledge Base pages, daily digests, and raw mobile notification messages.

**Architecture:** Create a standalone `fishing-assistant-service` that owns Knowledge Base, chunks, embeddings, chats, retrieval, prompt construction, and citation validation. Keep mobile notification storage in `mobile-notifications-service`; expose only the internal routes needed for digest and raw-message evidence. Add web pages that follow the existing Code Tasks and Hellscript layout patterns.

**Tech Stack:** Fastify, Firestore, Firestore vector search, OpenAI `text-embedding-3-small` for service-owned embeddings, user OpenRouter key with fixed model `or:google/gemini-3-flash-preview`, React, Vite, Auth0, existing `@intexuraos/internal-clients`, `@intexuraos/llm-factory`, and `@intexuraos/llm-pricing`.

---

## Self-Review Gaps Closed By This Plan

- The design spec is not enough for implementation by itself. This plan adds concrete files, route contracts, tests, migration shape, deployment wiring, and execution order.
- Chat key handling is fixed here: do not add a new User Service route in v1. Use existing `UserServiceClient.getApiKeys(userId)` and build a local fixed-model chat adapter. No platform OpenRouter fallback is allowed.
- Vector search isolation is fixed here: use a composite vector index on `userId + embedding`, and validate that no retrieved chunk with another `userId` reaches prompt construction.
- Page update consistency is fixed here: never leave stale chunks active for edited page content. Failed indexing keeps the page visible but removes retrieval eligibility until reindex succeeds.
- Raw mobile message evidence is fixed here: do not require `sender`; make sender optional in group-message cleanup and citations.
- Retrieval quality is fixed here with deterministic v1 scoring, limits, and fallback behavior.
- Citation validation is fixed here with a strict JSON schema, one repair attempt, and fail-closed behavior.
- Follow-up expansion is fixed here: deterministic full-page follow-up detection expands from recent cited Knowledge Base pages.
- Web and deployment wiring are fixed here with exact config, manifest, environment, Terraform, and verification files.
- Optional seed import is defined but must not be run unless explicitly requested during development.

## File Map

### Mobile Notifications Service

- Modify: `apps/mobile-notifications-service/src/routes/internalRoutes.ts`
- Modify: `apps/mobile-notifications-service/src/domain/messageFilter.ts`
- Modify: `apps/mobile-notifications-service/src/domain/digestSubscriptions.ts` only if the implementation needs a helper export; do not change subscription data.
- Modify: `apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts`
- Modify: `apps/mobile-notifications-service/src/__tests__/domain/messageFilter.test.ts`
- Modify: `apps/mobile-notifications-service/src/__tests__/fakes.ts`

### Internal Clients

- Create: `packages/internal-clients/src/mobile-notifications-service/client.ts`
- Create: `packages/internal-clients/src/mobile-notifications-service/types.ts`
- Create: `packages/internal-clients/src/mobile-notifications-service/index.ts`
- Create: `packages/internal-clients/src/mobile-notifications-service/__tests__/client.test.ts`
- Modify: `packages/internal-clients/src/index.ts`

### Fishing Assistant Service

- Create through `/create-service fishing-assistant-service`, then complete verifier-required wiring.
- Create: `apps/fishing-assistant-service/package.json`
- Create: `apps/fishing-assistant-service/Dockerfile`
- Create: `apps/fishing-assistant-service/cloudbuild.yaml`
- Create: `apps/fishing-assistant-service/src/index.ts`
- Create: `apps/fishing-assistant-service/src/server.ts`
- Create: `apps/fishing-assistant-service/src/config.ts`
- Create: `apps/fishing-assistant-service/src/services.ts`
- Create: `apps/fishing-assistant-service/src/routes/index.ts`
- Create: `apps/fishing-assistant-service/src/routes/foldersRoutes.ts`
- Create: `apps/fishing-assistant-service/src/routes/pagesRoutes.ts`
- Create: `apps/fishing-assistant-service/src/routes/chatsRoutes.ts`
- Create: `apps/fishing-assistant-service/src/routes/digestsRoutes.ts`
- Create: `apps/fishing-assistant-service/src/routes/schemas.ts`
- Create: `apps/fishing-assistant-service/src/domain/models/*.ts`
- Create: `apps/fishing-assistant-service/src/domain/ports/*.ts`
- Create: `apps/fishing-assistant-service/src/domain/usecases/*.ts`
- Create: `apps/fishing-assistant-service/src/domain/retrieval/*.ts`
- Create: `apps/fishing-assistant-service/src/domain/chunking/*.ts`
- Create: `apps/fishing-assistant-service/src/domain/prompts/*.ts`
- Create: `apps/fishing-assistant-service/src/infra/firestore/*.ts`
- Create: `apps/fishing-assistant-service/src/infra/llm/*.ts`
- Create: `apps/fishing-assistant-service/src/infra/mobileNotifications/*.ts`
- Create: `apps/fishing-assistant-service/src/__tests__/*.test.ts`
- Create: `apps/fishing-assistant-service/src/__tests__/fakes.ts`

### Firestore And Deployment

- Create: `migrations/101_create_fishing_assistant_collections.mjs`
- Create: `migrations/__tests__/101-create-fishing-assistant-collections.test.ts`
- Modify: `firestore-collections.json`
- Modify: `terraform/environments/dev/main.tf`
- Modify: `terraform/modules/cloud-build/main.tf`
- Modify: `cloudbuild/cloudbuild.yaml`
- Create: `cloudbuild/scripts/deploy-fishing-assistant-service.sh`
- Modify: `.github/workflows/deploy.yml`
- Modify: `.envrc.local.example`
- Modify: `ecosystem.config.cjs`
- Modify: `apps/web/service-manifest.json`
- Modify: `apps/api-docs-hub` OpenAPI URL wiring if the service list is explicit there.

### Web

- Modify: `apps/web/src/config.ts`
- Modify: `apps/web/src/types/index.ts`
- Create: `apps/web/src/types/fishingAssistant.ts`
- Create: `apps/web/src/services/fishingAssistantApi.ts`
- Create: `apps/web/src/services/__tests__/fishingAssistantApi.test.ts`
- Create: `apps/web/src/hooks/useFishingKnowledge.ts`
- Create: `apps/web/src/hooks/useFishingChat.ts`
- Create: `apps/web/src/hooks/__tests__/useFishingKnowledge.test.ts`
- Create: `apps/web/src/hooks/__tests__/useFishingChat.test.ts`
- Modify: `apps/web/src/components/sidebar/navItems.ts`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/pages/fishing/FishingDigestsPage.tsx`
- Create: `apps/web/src/pages/fishing/FishingDigestViewPage.tsx`
- Create: `apps/web/src/pages/fishing/FishingKnowledgeBasePage.tsx`
- Create: `apps/web/src/pages/fishing/FishingKnowledgePageEditor.tsx`
- Create: `apps/web/src/pages/fishing/FishingChatPage.tsx`
- Create: `apps/web/src/components/fishing/*.tsx`

### Optional Seed Import

- Create only when implementation asks for it: `apps/fishing-assistant-service/src/cli/importSeedPages.ts`
- Add only when implementation asks for it: `apps/fishing-assistant-service/package.json` script `import:seed`
- Input must be the token-free JSONL index, for example `/tmp/skool-course-crawl/qna-index.jsonl`. Never read or commit raw Skool leaf JSON that may contain private tokens.

---

## Chunk 1: Mobile Notification Internal Evidence API

### Task 1: Extend group-message cleanup for optional sender

**Files:**
- Modify: `apps/mobile-notifications-service/src/domain/messageFilter.ts`
- Modify: `apps/mobile-notifications-service/src/__tests__/domain/messageFilter.test.ts`

- [ ] **Step 1: Add failing tests for senderless notification cleanup**

Add tests proving:

- a raw notification without a sender is accepted
- dedupe uses `(sender ?? title, text)` so senderless duplicate WhatsApp rows still collapse
- returned clean messages expose `senderLabel?: string | null`

Run:

```bash
pnpm vitest run apps/mobile-notifications-service/src/__tests__/domain/messageFilter.test.ts
```

Expected: FAIL until the model changes from required `sender` to optional sender label.

- [ ] **Step 2: Update the domain shape**

Change the cleanup model to:

```ts
export interface RawNotification {
  sender?: string | null;
  text: string;
  postTime: string;
  title: string;
  app: string;
}

export interface CleanMessage {
  senderLabel?: string | null;
  text: string;
  postTimeSec: number;
}
```

Use `senderLabel ?? title` only for dedupe keys. Do not expose title as a sender citation unless there is reliable sender parsing later.

- [ ] **Step 3: Run the message filter tests**

Run:

```bash
pnpm vitest run apps/mobile-notifications-service/src/__tests__/domain/messageFilter.test.ts
```

Expected: PASS.

### Task 2: Add internal digest and raw-message routes

**Files:**
- Modify: `apps/mobile-notifications-service/src/routes/internalRoutes.ts`
- Modify: `apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts`
- Modify: `apps/mobile-notifications-service/src/__tests__/fakes.ts`

- [ ] **Step 1: Add failing route tests**

Add tests for these internal routes:

```text
POST /internal/notifications/digest-subscriptions/list
POST /internal/notifications/digests/query
POST /internal/notifications/digests/get
POST /internal/notifications/digest-state/get
POST /internal/notifications/group-messages/query
```

Minimum cases:

- missing and invalid `x-internal-auth`
- subscription list filters by `userId`
- digest query validates date range and calls `digestRepository.findInRange`
- digest get returns 404 when missing
- state get returns 404 when missing
- group-message query requires date or date range
- group-message query validates date range length
- group-message query validates subscription ownership
- group-message query filters WhatsApp app and group title prefix
- group-message query uses `postTimeSecFrom` and `postTimeSecTo`
- group-message query removes meta rows
- group-message query deduplicates repeated notification rows
- group-message query applies term filtering after cleanup

Run:

```bash
pnpm vitest run apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts
```

Expected: FAIL because routes do not exist yet.

- [ ] **Step 2: Implement request and response contracts**

Use `reply.ok(...)` and `reply.fail(...)` envelopes. Validate `x-internal-auth` with `validateInternalAuth(request)`.

Subscription list request:

```ts
{ userId: string }
```

Subscription list response:

```ts
{
  items: Array<{ groupKey: string; displayName: string }>;
}
```

Digest query request:

```ts
{
  userId: string;
  groupKey: string;
  dateFrom: string;
  dateTo: string;
  terms?: string[];
  limit?: number;
}
```

Digest query response:

```ts
{
  items: Array<{
    groupKey: string;
    date: string;
    title: string;
    summaryMarkdown: string;
    messageCount: number;
  }>;
  truncated: boolean;
}
```

Digest get request:

```ts
{ userId: string; groupKey: string; date: string }
```

Digest state get request:

```ts
{ userId: string; groupKey: string }
```

Group messages query request:

```ts
{
  userId: string;
  groupKey: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  terms?: string[];
  limit?: number;
}
```

Group messages query response:

```ts
{
  messages: Array<{
    messageRef: string;
    groupKey: string;
    date: string;
    postTimeSec: number;
    senderLabel?: string | null;
    text: string;
    quote: string;
  }>;
  totalRaw: number;
  totalCleaned: number;
  returned: number;
  truncated: boolean;
}
```

- [ ] **Step 3: Implement group-message querying**

Implementation details:

- validate subscription exists for `userId + groupKey`
- use subscription `groupTitlePrefix`
- query `notificationRepository.findByUserIdPaginated(userId, { limit, filter })`
- set `filter.app = ['com.whatsapp']`
- set `filter.title = groupTitlePrefix`
- use CET day bounds from existing digest code for `postTimeSecFrom` and `postTimeSecTo`
- pass notifications through `filterAndDedupeNotifications`
- term-filter cleaned messages by lowercase Polish-preserving substring match
- return oldest-to-newest messages
- derive `messageRef` from `date`, `postTimeSec`, and a short stable hash of title/text

- [ ] **Step 4: Fix test fake date filtering**

Update `FakeNotificationRepository.findByUserIdPaginated(...)` to honor:

```ts
options.filter?.postTimeSecFrom
options.filter?.postTimeSecTo
```

The real repository already supports these fields.

- [ ] **Step 5: Run mobile notification tests**

Run:

```bash
pnpm vitest run \
  apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts \
  apps/mobile-notifications-service/src/__tests__/domain/messageFilter.test.ts
```

Expected: PASS.

### Task 3: Add typed mobile-notifications internal client

**Files:**
- Create: `packages/internal-clients/src/mobile-notifications-service/types.ts`
- Create: `packages/internal-clients/src/mobile-notifications-service/client.ts`
- Create: `packages/internal-clients/src/mobile-notifications-service/index.ts`
- Create: `packages/internal-clients/src/mobile-notifications-service/__tests__/client.test.ts`
- Modify: `packages/internal-clients/src/index.ts`

- [ ] **Step 1: Write client tests**

Use `createInternalHttpClient` test style. Cover:

- each method sends `x-internal-auth`
- each method uses the exact internal path
- envelope errors are returned without throwing
- group-message request preserves optional `terms`

Run:

```bash
pnpm vitest run packages/internal-clients/src/mobile-notifications-service/__tests__/client.test.ts
```

Expected: FAIL because client does not exist.

- [ ] **Step 2: Implement client facade**

Expose:

```ts
createMobileNotificationsServiceClient(config: {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
}): MobileNotificationsServiceClient
```

Methods:

```ts
listDigestSubscriptions(input)
queryDigests(input)
getDigest(input)
getDigestState(input)
queryGroupMessages(input)
```

Use `createInternalHttpClient` from `packages/internal-clients/src/shared/createInternalHttpClient.ts`.

- [ ] **Step 3: Export the package entry**

Export from:

```ts
packages/internal-clients/src/mobile-notifications-service/index.ts
packages/internal-clients/src/index.ts
```

- [ ] **Step 4: Run client tests**

Run:

```bash
pnpm vitest run packages/internal-clients/src/mobile-notifications-service/__tests__/client.test.ts
```

Expected: PASS.

---

## Chunk 2: Service Scaffolding, Env, Deployment, And Storage

### Task 4: Scaffold `fishing-assistant-service`

**Files:**
- Create and modify all files required by `.claude/commands/create-service.md`

- [ ] **Step 1: Run the project command**

Use the existing create-service command instructions for:

```text
fishing-assistant-service
```

This is a Cloud Run app, not a worker.

- [ ] **Step 2: Add required dependencies**

`apps/fishing-assistant-service/package.json` needs at least:

```json
{
  "dependencies": {
    "@intexuraos/infra-firestore": "workspace:*",
    "@intexuraos/infra-sentry": "workspace:*",
    "@intexuraos/internal-clients": "workspace:*",
    "@intexuraos/llm-contract": "workspace:*",
    "@intexuraos/llm-factory": "workspace:*",
    "@intexuraos/llm-pricing": "workspace:*",
    "openai": "catalog:"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

Use catalog/workspace versions that match nearby services if the lockfile has changed.

- [ ] **Step 3: Define config**

`apps/fishing-assistant-service/src/config.ts` should load:

```ts
{
  port: number;
  gcpProjectId: string;
  authJwksUrl: string;
  authIssuer: string;
  authAudience: string;
  internalAuthToken: string;
  userServiceUrl: string;
  mobileNotificationsServiceUrl: string;
  llmUsageServiceUrl: string;
  openAiAppApiKey: string;
  sentryDsn?: string;
  environment: string;
}
```

`apps/fishing-assistant-service/src/index.ts` required env must exactly match used Terraform/env vars:

```ts
[
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_AUTH_JWKS_URL',
  'INTEXURAOS_AUTH_ISSUER',
  'INTEXURAOS_AUTH_AUDIENCE',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_USER_SERVICE_URL',
  'INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL',
  'INTEXURAOS_LLM_USAGE_SERVICE_URL',
  'INTEXURAOS_OPENAI_APP_API_KEY',
]
```

Do not require `INTEXURAOS_OPENROUTER_APP_API_KEY`.

- [ ] **Step 4: Wire services**

`apps/fishing-assistant-service/src/services.ts` must create:

- Firestore repositories
- OpenAI embedding client using `INTEXURAOS_OPENAI_APP_API_KEY`
- User Service internal client
- Mobile Notifications internal client
- LLM usage sink
- fixed-model Gemini/OpenRouter chat adapter

Do not add production fallbacks in `getServices()`.

- [ ] **Step 5: Run scaffold verification**

Run:

```bash
bash scripts/verify-service-scaffolding.sh fishing-assistant-service
```

Expected: PASS after all scaffold/deploy files are complete.

### Task 5: Add deployment and local environment wiring

**Files:**
- Modify: `terraform/environments/dev/main.tf`
- Modify: `terraform/modules/cloud-build/main.tf`
- Modify: `cloudbuild/cloudbuild.yaml`
- Create: `cloudbuild/scripts/deploy-fishing-assistant-service.sh`
- Create: `apps/fishing-assistant-service/cloudbuild.yaml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `.envrc.local.example`
- Modify: `ecosystem.config.cjs`
- Modify: `apps/web/service-manifest.json`

- [ ] **Step 1: Add service URL env**

Use:

```text
INTEXURAOS_FISHING_ASSISTANT_SERVICE_URL
```

Suggested local port:

```text
8117
```

If `8117` is occupied in `ecosystem.config.cjs`, use the next free service port and keep `.envrc.local.example` aligned.

- [ ] **Step 2: Add Terraform service**

Add `fishing_assistant_service` to `local.services`, IAM service accounts, and the Cloud Run module.

The service needs common service secrets/env vars plus:

```hcl
secrets = merge(local.common_service_secrets, {
  INTEXURAOS_OPENAI_APP_API_KEY = module.secret_manager.secret_ids["INTEXURAOS_OPENAI_APP_API_KEY"]
})
```

Do not add a platform OpenRouter key.

- [ ] **Step 3: Add build/deploy wiring**

Add service entries in:

- `cloudbuild/cloudbuild.yaml`
- `terraform/modules/cloud-build/main.tf` `docker_services`
- `.github/workflows/deploy.yml` all hardcoded service arrays
- `apps/web/service-manifest.json`

- [ ] **Step 4: Add API docs wiring if explicit**

Search for existing OpenAPI URL envs:

```bash
rg -n "OPENAPI_URL|service-manifest|api-docs" apps/api-docs-hub ecosystem.config.cjs terraform/environments/dev/main.tf
```

If `api-docs-hub` has an explicit list, add:

```text
INTEXURAOS_FISHING_ASSISTANT_SERVICE_OPENAPI_URL
```

- [ ] **Step 5: Run env/deploy verifiers**

Run:

```bash
bash scripts/verify-service-scaffolding.sh fishing-assistant-service
pnpm run verify:terraform-secrets
node scripts/verify-web-service-manifest.mjs
```

Expected: PASS.

### Task 6: Add Firestore collections and vector indexes

**Files:**
- Create: `migrations/101_create_fishing_assistant_collections.mjs`
- Create: `migrations/__tests__/101-create-fishing-assistant-collections.test.ts`
- Modify: `firestore-collections.json`

- [ ] **Step 1: Add failing migration tests**

Test that the migration defines:

- collection rules for `fishing_knowledge_folders/{folderId}`
- collection rules for `fishing_knowledge_pages/{pageId}`
- collection rules for `fishing_knowledge_chunks/{chunkId}`
- collection rules for `fishing_chats/{chatId}`
- collection rules for `fishing_chat_messages/{messageId}`
- composite vector index on `fishing_knowledge_chunks` with `userId ASCENDING` and `embedding vectorConfig dimension 1536`
- folder listing index on `fishing_knowledge_folders`: `userId ASCENDING`, `updatedAt DESCENDING`
- page listing index on `fishing_knowledge_pages`: `userId ASCENDING`, `folderId ASCENDING`, `updatedAt DESCENDING`
- chat listing index on `fishing_chats`: `userId ASCENDING`, `lastMessageAt DESCENDING`
- message listing index on `fishing_chat_messages`: `userId ASCENDING`, `chatId ASCENDING`, `createdAt ASCENDING`

Run:

```bash
pnpm vitest run migrations/__tests__/101-create-fishing-assistant-collections.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement migration**

Use this vector index shape before aggregation normalization:

```js
{
  collectionGroup: 'fishing_knowledge_chunks',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'userId', order: 'ASCENDING' },
    {
      fieldPath: 'embedding',
      order: 'ASCENDING',
      vectorConfig: {
        dimension: 1536,
        flatIndexEnabled: true,
      },
    },
  ],
}
```

The migration aggregator strips vector `order` as needed. Add a test that protects this through `normalizeVectorFields(...)` if there is any uncertainty.

- [ ] **Step 3: Register collections**

Add every new collection to `firestore-collections.json`.

- [ ] **Step 4: Run migration verification**

Run:

```bash
pnpm vitest run migrations/__tests__/101-create-fishing-assistant-collections.test.ts
pnpm run verify:migrations
```

Expected: PASS.

---

## Chunk 3: Knowledge Base Domain, CRUD, Indexing, And Embeddings

### Task 7: Implement normalization, title inference, and chunking

**Files:**
- Create: `apps/fishing-assistant-service/src/domain/chunking/normalizePageText.ts`
- Create: `apps/fishing-assistant-service/src/domain/chunking/inferTitle.ts`
- Create: `apps/fishing-assistant-service/src/domain/chunking/chunkPage.ts`
- Create: `apps/fishing-assistant-service/src/domain/chunking/classifyPage.ts`
- Create: `apps/fishing-assistant-service/src/__tests__/chunking.test.ts`

- [ ] **Step 1: Write chunking tests**

Cover:

- title is first non-empty header-like line
- title falls back to an injected title inference LLM port only when no header exists
- Polish characters and units are preserved
- bullets are normalized without losing quantities
- headings split chunks before size splitting
- chunks target 800-1200 characters, max 1600
- overlap uses last 1-2 sentences or 100-150 characters
- `searchableText` prepends folder, page, and heading context
- broad `contentType` classification handles recipe, guide, species, theory, additive, qna, other

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/chunking.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement deterministic chunking**

No LLM chunking. Heading detection should be deterministic:

- first non-empty line can be title
- lines ending with `:` can be section headings
- short standalone lines followed by bullets can be headings
- do not infer deep hierarchy; store only current heading string

- [ ] **Step 3: Run chunking tests**

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/chunking.test.ts
```

Expected: PASS.

### Task 8: Implement Firestore repositories and page indexing consistency

**Files:**
- Create: `apps/fishing-assistant-service/src/domain/models/knowledge.ts`
- Create: `apps/fishing-assistant-service/src/domain/ports/knowledgeRepositories.ts`
- Create: `apps/fishing-assistant-service/src/infra/firestore/folderRepository.ts`
- Create: `apps/fishing-assistant-service/src/infra/firestore/pageRepository.ts`
- Create: `apps/fishing-assistant-service/src/infra/firestore/chunkRepository.ts`
- Create: `apps/fishing-assistant-service/src/__tests__/knowledgeRepositories.test.ts`

- [ ] **Step 1: Write repository tests**

Cover:

- every query includes `userId`
- folder names can be duplicated unless simple uniqueness is added
- page create stores raw and normalized text
- page update does not expose chunks from another user
- page delete deletes chunks and updates folder `pageCount`
- `findNearestByUserId(...)` uses `where('userId', '==', userId).findNearest(...)`
- returned vector matches are rejected if `doc.userId !== input.userId`

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/knowledgeRepositories.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement repository contracts**

Use collection names:

```text
fishing_knowledge_folders
fishing_knowledge_pages
fishing_knowledge_chunks
```

Chunk storage must use:

```ts
FieldValue.vector(input.embedding)
```

Vector query must use:

```ts
collection.where('userId', '==', userId).findNearest({
  vectorField: 'embedding',
  queryVector: FieldValue.vector(embedding),
  limit,
  distanceMeasure: 'COSINE',
  distanceResultField: 'vectorDistance',
})
```

Compute `vectorScore = 1 - vectorDistance`.

- [ ] **Step 3: Implement save consistency**

For page create:

- normalize and chunk first
- if embedding succeeds, batch page + chunks with `indexingStatus: 'ready'`
- if embedding fails, save page with `indexingStatus: 'failed'`, no chunks

For page update:

- normalize and chunk first
- if embedding succeeds, batch page update + delete previous chunks + write new chunks
- if embedding fails, batch page update + delete previous chunks + set `indexingStatus: 'failed'`
- never leave old chunks active for edited page content
- expose `POST /fishing/pages/:pageId/reindex` to retry indexing from stored `rawText`

Cap a single page at 120 chunks in v1. Return `PAGE_TOO_LARGE` if chunking would exceed that limit.

- [ ] **Step 4: Run repository tests**

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/knowledgeRepositories.test.ts
```

Expected: PASS.

### Task 9: Add Knowledge Base routes

**Files:**
- Create: `apps/fishing-assistant-service/src/routes/foldersRoutes.ts`
- Create: `apps/fishing-assistant-service/src/routes/pagesRoutes.ts`
- Create: `apps/fishing-assistant-service/src/routes/schemas.ts`
- Create: `apps/fishing-assistant-service/src/__tests__/knowledgeRoutes.test.ts`

- [ ] **Step 1: Write route tests**

Cover:

- Auth0 auth required
- all writes use authenticated `userId`
- folder list/create/update/delete
- folder delete returns `409 FOLDER_NOT_EMPTY`
- page list/create/get/update/delete/reindex
- page delete deletes chunks
- failed embedding returns visible failed state
- no raw page body is written through request logs

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/knowledgeRoutes.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement public routes**

Routes:

```text
GET    /fishing/folders
POST   /fishing/folders
PATCH  /fishing/folders/:folderId
DELETE /fishing/folders/:folderId

GET    /fishing/pages
POST   /fishing/pages
GET    /fishing/pages/:pageId
PATCH  /fishing/pages/:pageId
DELETE /fishing/pages/:pageId
POST   /fishing/pages/:pageId/reindex
```

Use `logIncomingRequest` with no raw body logging for page create/update. If logging is necessary, set body preview to `0` or log only metadata.

- [ ] **Step 3: Run route tests**

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/knowledgeRoutes.test.ts
```

Expected: PASS.

---

## Chunk 4: Gemini Client, Retrieval, Citations, And Persisted Chat

### Task 10: Implement fixed-model Gemini/OpenRouter chat adapter

**Files:**
- Create: `apps/fishing-assistant-service/src/domain/ports/chatModel.ts`
- Create: `apps/fishing-assistant-service/src/infra/llm/fixedGeminiFlashClient.ts`
- Create: `apps/fishing-assistant-service/src/infra/llm/embeddingClient.ts`
- Create: `apps/fishing-assistant-service/src/__tests__/llmClients.test.ts`

- [ ] **Step 1: Write LLM adapter tests**

Cover:

- chat uses model `or:google/gemini-3-flash-preview`
- chat fetches user keys through `UserServiceClient.getApiKeys(userId)`
- missing `openrouter` key returns `NO_API_KEY`
- no platform OpenRouter key is read or accepted
- usage sink is passed to `createLlmClient`
- embedding client uses service OpenAI key and `text-embedding-3-small`
- embedding result must be 1536 dimensions

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/llmClients.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement chat adapter**

Use:

```ts
const keys = await userServiceClient.getApiKeys(userId);
const apiKey = keys.value.openrouter;
```

If the key is missing:

```ts
return err({ code: 'NO_API_KEY', message: 'OpenRouter API key is required for Fishing Assistant chat.' });
```

Then call `createLlmClient` with:

```ts
{
  apiKey,
  model: 'or:google/gemini-3-flash-preview',
  userId,
  usageSink,
  ownerType: 'user',
  logger,
}
```

- [ ] **Step 3: Run LLM tests**

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/llmClients.test.ts
```

Expected: PASS.

### Task 11: Implement retrieval and reranking

**Files:**
- Create: `apps/fishing-assistant-service/src/domain/retrieval/types.ts`
- Create: `apps/fishing-assistant-service/src/domain/retrieval/extractSearchTerms.ts`
- Create: `apps/fishing-assistant-service/src/domain/retrieval/retrieveEvidence.ts`
- Create: `apps/fishing-assistant-service/src/domain/retrieval/rerankEvidence.ts`
- Create: `apps/fishing-assistant-service/src/infra/mobileNotifications/mobileEvidenceClient.ts`
- Create: `apps/fishing-assistant-service/src/__tests__/retrieval.test.ts`

- [ ] **Step 1: Write retrieval tests**

Cover:

- KB vector results are requested with `userId`
- foreign-user chunks are dropped even if repository returns them
- digest retrieval uses explicit date range when present in question
- digest retrieval otherwise uses the last 90 days in v1
- raw messages are queried only for top digest dates or explicit date range
- final evidence is capped
- no evidence returns a typed `NO_EVIDENCE` result
- mobile notification failures degrade to KB-only retrieval when KB evidence exists

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/retrieval.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement deterministic scoring**

Use this v1 evidence shape:

```ts
{
  id: string;
  sourceType: 'knowledge_page' | 'digest' | 'raw_message';
  title: string;
  date?: string;
  heading?: string;
  text: string;
  quote: string;
  url?: string;
  score: number;
  metadata?: Record<string, unknown>;
}
```

Scoring:

- KB score: `0.75 * vectorScore + 0.20 * lexicalScore + 0.05 * contentTypeBoost`
- Digest score: `0.70 * lexicalScore + 0.20 * dateMatchBoost + 0.10 * discussionBoost`
- Raw message score: `0.75 * lexicalScore + 0.15 * dateMatchBoost + 0.10 * digestDateBoost`

Definitions:

- `lexicalScore`: matched unique query terms divided by total unique query terms, capped at `1`
- `contentTypeBoost`: `1` for recipe-like questions matching recipe/additive pages, else `0`
- `dateMatchBoost`: `1` when the user supplied an explicit date/range and the item is inside it, else `0`
- `discussionBoost`: `1` when digest has non-empty summary and message count > 0
- `digestDateBoost`: `1` when the raw message date came from a top digest match

Limits:

- KB vector query: 20, keep top 12
- digests: keep top 8
- raw messages: query top 3 digest dates or explicit range, keep top 12
- final prompt evidence: max 16 blocks, max 24,000 characters total

If no KB evidence exists but digest/raw evidence exists, answer can still proceed with lower confidence.

- [ ] **Step 3: Run retrieval tests**

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/retrieval.test.ts
```

Expected: PASS.

### Task 12: Implement prompting, citation validation, and follow-up expansion

**Files:**
- Create: `apps/fishing-assistant-service/src/domain/prompts/buildFishingAnswerPrompt.ts`
- Create: `apps/fishing-assistant-service/src/domain/prompts/parseFishingAnswer.ts`
- Create: `apps/fishing-assistant-service/src/domain/prompts/validateCitations.ts`
- Create: `apps/fishing-assistant-service/src/domain/retrieval/followUpExpansion.ts`
- Create: `apps/fishing-assistant-service/src/__tests__/citationValidation.test.ts`
- Create: `apps/fishing-assistant-service/src/__tests__/followUpExpansion.test.ts`

- [ ] **Step 1: Write validation tests**

Cover:

- valid JSON output with known citation IDs passes
- unknown citation IDs fail
- uncited factual answer fails
- explicit insufficient-evidence answer can have no citations
- invalid output gets one repair attempt
- failed repair returns no answer text to the UI

Run:

```bash
pnpm vitest run \
  apps/fishing-assistant-service/src/__tests__/citationValidation.test.ts \
  apps/fishing-assistant-service/src/__tests__/followUpExpansion.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement answer schema**

Use zod schema:

```ts
{
  answerMarkdown: string;
  citations: Array<{ sourceId: string; usedFor: string }>;
  confidence: 'high' | 'medium' | 'low';
}
```

Validation rules:

- every `sourceId` must exist in retrieved evidence
- answer must cite at least one source unless it explicitly says evidence is insufficient
- one repair prompt is allowed
- if repair fails, return `CITATION_VALIDATION_FAILED`

- [ ] **Step 3: Implement full-page follow-up expansion**

Detect follow-ups deterministically from the latest user message:

```ts
/(full|entire|whole).*(recipe|receipt|page|text)|ca[lł]y.*(przepis|tekst|stron[ay])|pe[lł]ny.*(przepis|tekst)/i
```

When matched:

- inspect the last 6 chat messages
- collect cited `knowledge_page` page IDs from assistant messages
- fetch up to 3 full pages for that user
- add full page raw text as evidence with source IDs like `S_FULL_1`
- do not expand raw messages or digest summaries into a full page

- [ ] **Step 4: Run validation tests**

Run:

```bash
pnpm vitest run \
  apps/fishing-assistant-service/src/__tests__/citationValidation.test.ts \
  apps/fishing-assistant-service/src/__tests__/followUpExpansion.test.ts
```

Expected: PASS.

### Task 13: Implement persisted chat domain and routes

**Files:**
- Create: `apps/fishing-assistant-service/src/domain/models/chat.ts`
- Create: `apps/fishing-assistant-service/src/domain/ports/chatRepository.ts`
- Create: `apps/fishing-assistant-service/src/infra/firestore/chatRepository.ts`
- Create: `apps/fishing-assistant-service/src/domain/usecases/sendChatMessage.ts`
- Create: `apps/fishing-assistant-service/src/routes/chatsRoutes.ts`
- Create: `apps/fishing-assistant-service/src/__tests__/chatRoutes.test.ts`

- [ ] **Step 1: Write chat tests**

Cover:

- create chat
- list chats for current user only
- get chat
- list messages oldest-to-newest
- send message appends user message, retrieves evidence, calls Gemini, validates citations, appends assistant message
- chat title is deterministic from first user message unless title inference is needed
- missing OpenRouter key maps to actionable UI error
- follow-up "give me the full recipe" expands previous cited pages

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/chatRoutes.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement chat routes**

Routes:

```text
GET    /fishing/chats
POST   /fishing/chats
GET    /fishing/chats/:chatId
GET    /fishing/chats/:chatId/messages
POST   /fishing/chats/:chatId/messages
```

There is no delete, rename, or archive in v1.

- [ ] **Step 3: Run chat tests**

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/chatRoutes.test.ts
```

Expected: PASS.

### Task 14: Add Current Digests facade routes

**Files:**
- Create: `apps/fishing-assistant-service/src/routes/digestsRoutes.ts`
- Create: `apps/fishing-assistant-service/src/__tests__/digestsRoutes.test.ts`

- [ ] **Step 1: Write digest facade tests**

Cover:

- authenticated user required
- list groups from mobile notification internal API
- list digests for selected group/date range
- get digest detail
- mobile-notification service failure returns typed error

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/digestsRoutes.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement facade routes**

Routes:

```text
GET /fishing/digest-groups
GET /fishing/digests?groupKey=...&dateFrom=...&dateTo=...
GET /fishing/digests/:groupKey/:date
```

Use the mobile notifications internal client. The web UI should call the Fishing Assistant service for these pages, not the mobile-notifications service directly, so the Fishing Assistant menu has one service boundary.

- [ ] **Step 3: Run digest facade tests**

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/digestsRoutes.test.ts
```

Expected: PASS.

---

## Chunk 5: Web UI

### Task 15: Add web config, types, API client, and hooks

**Files:**
- Modify: `apps/web/src/config.ts`
- Modify: `apps/web/src/types/index.ts`
- Create: `apps/web/src/types/fishingAssistant.ts`
- Create: `apps/web/src/services/fishingAssistantApi.ts`
- Create: `apps/web/src/services/__tests__/fishingAssistantApi.test.ts`
- Create: `apps/web/src/hooks/useFishingKnowledge.ts`
- Create: `apps/web/src/hooks/useFishingChat.ts`
- Create: `apps/web/src/hooks/__tests__/useFishingKnowledge.test.ts`
- Create: `apps/web/src/hooks/__tests__/useFishingChat.test.ts`

- [ ] **Step 1: Write web API tests**

Cover:

- API client uses `config.fishingAssistantServiceUrl`
- folder/page/chat methods call exact `/fishing/...` routes
- references/citations are preserved in response types
- missing-key error is surfaced as typed `NO_API_KEY`

Run:

```bash
pnpm --filter @intexuraos/web test -- src/services/__tests__/fishingAssistantApi.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Add config**

Add to `AppConfig`:

```ts
fishingAssistantServiceUrl: string;
```

Add to `getConfig()`:

```ts
fishingAssistantServiceUrl: getServiceUrl(
  'INTEXURAOS_FISHING_ASSISTANT_SERVICE_URL',
  '/api/fishing-assistant'
),
```

- [ ] **Step 3: Implement client and hooks**

Follow patterns from:

- `apps/web/src/services/hellscriptAgentApi.ts`
- `apps/web/src/hooks/useHellscriptWorkspace.ts`
- `apps/web/src/services/codeAgentApi.ts`

- [ ] **Step 4: Run web API/hook tests**

Run:

```bash
pnpm --filter @intexuraos/web test -- \
  src/services/__tests__/fishingAssistantApi.test.ts \
  src/hooks/__tests__/useFishingKnowledge.test.ts \
  src/hooks/__tests__/useFishingChat.test.ts
```

Expected: PASS.

### Task 16: Add Fishing Assistant navigation and pages

**Files:**
- Modify: `apps/web/src/components/sidebar/navItems.ts`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/pages/fishing/FishingDigestsPage.tsx`
- Create: `apps/web/src/pages/fishing/FishingDigestViewPage.tsx`
- Create: `apps/web/src/pages/fishing/FishingKnowledgeBasePage.tsx`
- Create: `apps/web/src/pages/fishing/FishingKnowledgePageEditor.tsx`
- Create: `apps/web/src/pages/fishing/FishingChatPage.tsx`
- Create: `apps/web/src/components/fishing/FishingChatPanel.tsx`
- Create: `apps/web/src/components/fishing/FishingReferencesPanel.tsx`
- Create: `apps/web/src/components/fishing/FishingKnowledgeTree.tsx`
- Create: `apps/web/src/components/fishing/FishingPageEditor.tsx`
- Create: `apps/web/src/components/fishing/FishingDigestList.tsx`

- [ ] **Step 1: Write page/navigation tests**

Cover:

- sidebar has `Fishing Assistant`
- submenu items:
  - `Current Digests`
  - `Knowledge Base`
  - `Chat`
- routes render authenticated pages
- Knowledge Base supports folder CRUD and page CRUD
- chat list opens existing chats and starts a new chat
- references panel renders source labels and links
- missing OpenRouter key state links user to API key settings

Run:

```bash
pnpm --filter @intexuraos/web test -- src
```

Expected: FAIL until UI is implemented. If this full command is too broad during TDD, run the specific new test files first.

- [ ] **Step 2: Add nav items**

Add to `navItems.ts`:

```ts
export const fishingAssistantItems: NavItem[] = [
  { to: '/fishing-assistant/digests', label: 'Current Digests', icon: FileText },
  { to: '/fishing-assistant/knowledge', label: 'Knowledge Base', icon: Library },
  { to: '/fishing-assistant/chat', label: 'Chat', icon: MessageCircle },
];
```

Use available `lucide-react` icons. Add `Library` import if used.

- [ ] **Step 3: Add routes**

Add lazy pages in `App.tsx` and routes:

```text
/fishing-assistant/digests
/fishing-assistant/digests/:groupKey/:date
/fishing-assistant/knowledge
/fishing-assistant/knowledge/pages/:pageId
/fishing-assistant/chat
/fishing-assistant/chat/:chatId
```

- [ ] **Step 4: Build UI**

Design constraints:

- align with Code Tasks and Hellscript, not a landing page
- use a dense, work-focused layout
- chat page has persisted chat list, message timeline, composer, and references side panel
- citations link to `/fishing-assistant/knowledge/pages/:pageId` when the source is a Knowledge Base page
- digest citations link to `/fishing-assistant/digests/:groupKey/:date`
- raw message citations render quote + date and do not link to a raw private record
- do not add delete/rename/archive for chats in v1

- [ ] **Step 5: Run web checks**

Run:

```bash
pnpm --filter @intexuraos/web test -- src
pnpm --filter @intexuraos/web typecheck
pnpm --filter @intexuraos/web lint:local
```

Expected: PASS.

---

## Chunk 6: Optional Seed Import

### Task 17: Add seed import command only when requested

**Files:**
- Create when requested: `apps/fishing-assistant-service/src/cli/importSeedPages.ts`
- Modify when requested: `apps/fishing-assistant-service/package.json`
- Create when requested: `apps/fishing-assistant-service/src/__tests__/seedImport.test.ts`

- [ ] **Step 1: Confirm execution is requested**

Do not create or run seed import during normal implementation unless the user handling development explicitly asks for it.

- [ ] **Step 2: Implement token-safe importer**

Input:

```bash
pnpm --filter @intexuraos/fishing-assistant-service import:seed -- \
  --user-id "$USER_ID" \
  --input /tmp/skool-course-crawl/qna-index.jsonl \
  --dry-run
```

Rules:

- accept only token-free JSONL index records
- reject input paths containing `/raw-leaves/`
- map top-level fetched names to folders
- map each text-bearing record to a page
- use deterministic fingerprint `(sourcePath + title + normalizedText hash)` for idempotency
- run the same page normalization, chunking, embedding, and save flow as manual paste
- default to `--dry-run`; require `--write` to persist

- [ ] **Step 3: Test importer**

Run:

```bash
pnpm vitest run apps/fishing-assistant-service/src/__tests__/seedImport.test.ts
```

Expected: PASS.

---

## Chunk 7: Full Verification And PR Update

### Task 18: Run focused verification

Run:

```bash
pnpm vitest run \
  apps/mobile-notifications-service/src/__tests__/internalRoutes.test.ts \
  apps/mobile-notifications-service/src/__tests__/domain/messageFilter.test.ts \
  packages/internal-clients/src/mobile-notifications-service/__tests__/client.test.ts \
  migrations/__tests__/101-create-fishing-assistant-collections.test.ts \
  apps/fishing-assistant-service/src/__tests__ \
  apps/web/src/services/__tests__/fishingAssistantApi.test.ts \
  apps/web/src/hooks/__tests__/useFishingKnowledge.test.ts \
  apps/web/src/hooks/__tests__/useFishingChat.test.ts
```

Expected: PASS.

### Task 19: Run service and web static checks

Run:

```bash
pnpm --filter @intexuraos/fishing-assistant-service typecheck
pnpm --filter @intexuraos/fishing-assistant-service lint:local
pnpm --filter @intexuraos/fishing-assistant-service build
pnpm --filter @intexuraos/web typecheck
pnpm --filter @intexuraos/web lint:local
bash scripts/verify-service-scaffolding.sh fishing-assistant-service
pnpm run verify:migrations
pnpm run verify:terraform-secrets
pnpm run verify:logging
pnpm run verify:incoming-request-logging
```

Expected: PASS.

### Task 20: Run local smoke test

Start services:

```bash
pnpm exec pm2 start ecosystem.config.cjs --only fishing-assistant-service,web
```

Smoke test:

- open web app
- verify sidebar shows Fishing Assistant
- create folder
- paste a sample page
- verify page is visible and indexing succeeds
- start a chat
- ask a question covered by the pasted page
- verify every answer reference links to the right page or digest
- ask "give me the full recipe"
- verify the answer expands the previously cited full page

Stop or leave services according to the current development workflow.

### Task 21: Commit and push

Before commit:

```bash
git status -sb
git diff --check
```

Commit:

```bash
git add <intended files only>
git commit -m "feat: add fishing assistant rag"
git push -u origin "$(git branch --show-current)"
```

Update the existing PR if one already exists. Open a draft PR if there is no PR yet.
