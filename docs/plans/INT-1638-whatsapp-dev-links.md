# WhatsApp Dev Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WhatsApp notification links generated from the dev environment point at `https://dev.intexuraos.cloud` instead of any localhost URL, while keeping production links on `https://intexuraos.cloud`.

**Architecture:** Treat `INTEXURAOS_WEB_APP_URL` as the canonical public web app base URL for user-facing links. Fix the dev PM2 fallback to the externally reachable dev domain, then wire code-agent task notification links through the same variable instead of hardcoded or legacy URL variables. Leave service-to-service URLs on localhost in dev because those are internal PM2 calls, not user-facing WhatsApp links.

**Tech Stack:** TypeScript, Fastify services, PM2 dev config, Terraform Cloud Run env vars, Vitest, WhatsApp Pub/Sub publisher.

---

## Context

Linear issue: INT-1638

Linear comments: none.

Complexity: PLAN-DOC. This is a cross-cutting environment/link-generation fix with tests and env wiring, but it does not require independent parallel subtasks.

Relevant findings:

- `ecosystem.config.cjs` currently injects `INTEXURAOS_WEB_APP_URL` through `COMMON_SERVICE_ENV` with a fallback of `http://localhost:3000`.
- `ecosystem.config.cjs` also defines a service-specific `SERVICE_ENV_MAPPINGS['actions-agent'].INTEXURAOS_WEB_APP_URL` fallback of `http://localhost:3000`. Because `createServiceConfig()` spreads service-specific env after `COMMON_SERVICE_ENV`, this override takes precedence and must be removed or changed with the common fallback.
- `apps/actions-agent/src/index.ts` requires `INTEXURAOS_WEB_APP_URL` and passes it into the action use cases; `handleActionTemplate.ts` and the supported per-type executors use that value for WhatsApp approval or completion links.
- `apps/mobile-notifications-service/src/services.ts` uses `INTEXURAOS_WEB_APP_URL` for digest CTA links.
- `apps/research-agent/src/routes/helpers/completionHandlers.ts` and research synthesis flows use `INTEXURAOS_WEB_APP_URL` for generated web links.
- `apps/code-agent/src/infra/services/whatsappNotifierImpl.ts` currently hardcodes `https://intexuraos.cloud` for code task WhatsApp CTA links.
- `apps/code-agent/src/domain/usecases/mergeConflicts/notifyConflicts.ts` uses the legacy `INTEXURAOS_WEB_URL` variable for task links in managed PR comments.
- `apps/web/src/App.tsx` confirms the required hash routes exist: `/#/code-tasks/:id`, `/#/inbox`, `/#/research/:id`, and `/#/notifications/digests/:groupKey/:date`.

## File Map

Modify:

- `ecosystem.config.cjs` - change the common dev fallback for `INTEXURAOS_WEB_APP_URL` from localhost to `https://dev.intexuraos.cloud`, and remove or align the `actions-agent` service-specific override that currently defeats the common value.
- `scripts/__tests__/ecosystem.config.test.ts` - prove PM2-injected dev services receive the external dev web app URL when the shell does not override it.
- `apps/code-agent/src/index.ts` - add `INTEXURAOS_WEB_APP_URL` to startup validation and replace the optional `INTEXURAOS_WEB_URL` note with the canonical env var.
- `apps/code-agent/src/config.ts` - load `webAppUrl` from `INTEXURAOS_WEB_APP_URL`.
- `apps/code-agent/src/services/types.ts` - add `webAppUrl` to `ServiceConfig`.
- `apps/code-agent/src/index.ts` - pass `config.webAppUrl` into `initServices`.
- `apps/code-agent/src/services.ts` - pass `config.webAppUrl` into `createWhatsAppNotifier`.
- `apps/code-agent/src/__tests__/services/factories/services.test.ts` - add a default `webAppUrl` to the `ServiceConfig` factory.
- `apps/code-agent/src/__tests__/services/factories/clientFactory.test.ts` - add a default `webAppUrl` to the `ServiceConfig` factory.
- `apps/code-agent/src/__tests__/services/factories/publisherFactory.test.ts` - add a default `webAppUrl` to the `ServiceConfig` factory.
- `apps/code-agent/src/__tests__/services/factories/llmFactory.test.ts` - add a default `webAppUrl` to the `ServiceConfig` factory.
- `apps/code-agent/src/infra/services/whatsappNotifierImpl.ts` - build task CTA URLs from configured web app URL.
- `apps/code-agent/src/__tests__/infra/services/whatsappNotifier.test.ts` - cover configured dev URL and trailing slash normalization.
- `apps/code-agent/src/domain/usecases/mergeConflicts/notifyConflicts.ts` - use `INTEXURAOS_WEB_APP_URL` instead of `INTEXURAOS_WEB_URL`.
- `apps/code-agent/src/__tests__/domain/usecases/mergeConflicts/notifyConflicts.test.ts` - update env-var tests to the canonical name.
- `terraform/environments/dev/main.tf` - inject `INTEXURAOS_WEB_APP_URL = "https://${var.web_app_domain}"` into the code-agent Cloud Run module.

Do not modify:

- `apps/actions-agent/src/domain/usecases/*Action.ts` link-building logic unless tests reveal a bug after the env fallback is corrected. The code already consumes `webAppUrl`; the wrong dev domain comes from configuration.
- Web routes in `apps/web/src/App.tsx`; the required hash routes already exist.
- Service-to-service localhost URLs in `COMMON_SERVICE_URLS`; they are internal dev PM2 wiring, not WhatsApp public links.

## Endpoint Changes

Modified: none.

Created: none.

Removed: none.

Unchanged:

- All HTTP endpoints and route schemas.
- Web hash routes for code tasks, inbox, research, and notification digests.

---

### Task 1: Pin Dev Web App URL In PM2 Config

**Files:**

- Modify: `scripts/__tests__/ecosystem.config.test.ts`
- Modify: `ecosystem.config.cjs`

- [ ] **Step 1: Write the failing ecosystem config test**

Add a helper and test to `scripts/__tests__/ecosystem.config.test.ts` after the existing `loadWhatsAppPubSubEnv()` helper.

```typescript
function loadWhatsAppLinkProducerWebAppEnv(): Record<string, string | undefined> {
  const stdout = execFileSync(
    process.execPath,
    [
      '-e',
      `
        const config = require('./ecosystem.config.cjs');
        const names = ${JSON.stringify(['actions-agent', 'code-agent', 'mobile-notifications-service', 'research-agent'])};
        const result = {};
        for (const name of names) {
          const app = config.apps.find((entry) => entry.name === name);
          if (!app) {
            throw new Error(name + ' missing from ecosystem config');
          }
          result[name] = app.env.INTEXURAOS_WEB_APP_URL;
        }
        process.stdout.write(JSON.stringify(result));
      `,
    ],
    {
      cwd: process.cwd(),
      env: {
        HOME: process.env.HOME ?? '/tmp',
        PATH: process.env.PATH ?? '',
      },
    }
  );

  return JSON.parse(stdout.toString()) as Record<string, string | undefined>;
}
```

Add this assertion inside `describe('ecosystem.config.cjs', () => { ... })`.

```typescript
it('uses externally reachable dev web app URL for WhatsApp link producers', () => {
  expect(loadWhatsAppLinkProducerWebAppEnv()).toEqual({
    'actions-agent': 'https://dev.intexuraos.cloud',
    'code-agent': 'https://dev.intexuraos.cloud',
    'mobile-notifications-service': 'https://dev.intexuraos.cloud',
    'research-agent': 'https://dev.intexuraos.cloud',
  });
});
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run:

```bash
pnpm exec vitest run scripts/__tests__/ecosystem.config.test.ts
```

Expected: FAIL because the services receive `http://localhost:3000`.

- [ ] **Step 3: Change the PM2 fallback and actions-agent override**

In `ecosystem.config.cjs`, update `COMMON_SERVICE_ENV.INTEXURAOS_WEB_APP_URL`.

```javascript
const COMMON_SERVICE_ENV = {
  HOME: process.env.HOME ?? '/root',
  PUBSUB_EMULATOR_HOST: 'localhost:8102',
  // ...
  INTEXURAOS_WEB_APP_URL:
    process.env.INTEXURAOS_WEB_APP_URL ?? 'https://dev.intexuraos.cloud',
  // ...
};
```

Keep `process.env.INTEXURAOS_WEB_APP_URL` first so operators can override the public base URL explicitly.

Then remove the redundant `SERVICE_ENV_MAPPINGS['actions-agent'].INTEXURAOS_WEB_APP_URL` entry entirely so `actions-agent` inherits the common value. If the implementation keeps the service-specific entry for a concrete reason, update its fallback to the same `https://dev.intexuraos.cloud` value and document why the override still exists.

```javascript
'actions-agent': {
  INTEXURAOS_PUBSUB_ACTIONS_QUEUE: process.env.INTEXURAOS_PUBSUB_ACTIONS_QUEUE ?? 'actions-queue',
  INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
    process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'whatsapp-send-message',
  INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC:
    process.env.INTEXURAOS_PUBSUB_CALENDAR_PREVIEW_TOPIC ?? 'calendar-preview',
},
```

- [ ] **Step 4: Run the targeted test and confirm it passes**

Run:

```bash
pnpm exec vitest run scripts/__tests__/ecosystem.config.test.ts
```

Expected: PASS, including the `actions-agent` assertion. If only `actions-agent` still reports `http://localhost:3000`, the service-specific override was not removed or aligned.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add ecosystem.config.cjs scripts/__tests__/ecosystem.config.test.ts
git commit -m "fix(INT-1638): use dev web URL in PM2 WhatsApp link env"
```

---

### Task 2: Wire Code-Agent Task Links To The Canonical Web App URL

**Files:**

- Modify: `apps/code-agent/src/index.ts`
- Modify: `apps/code-agent/src/config.ts`
- Modify: `apps/code-agent/src/services/types.ts`
- Modify: `apps/code-agent/src/services.ts`
- Modify: `apps/code-agent/src/__tests__/services/factories/services.test.ts`
- Modify: `apps/code-agent/src/__tests__/services/factories/clientFactory.test.ts`
- Modify: `apps/code-agent/src/__tests__/services/factories/publisherFactory.test.ts`
- Modify: `apps/code-agent/src/__tests__/services/factories/llmFactory.test.ts`
- Modify: `apps/code-agent/src/infra/services/whatsappNotifierImpl.ts`
- Modify: `apps/code-agent/src/__tests__/infra/services/whatsappNotifier.test.ts`
- Modify: `apps/code-agent/src/domain/usecases/mergeConflicts/notifyConflicts.ts`
- Modify: `apps/code-agent/src/__tests__/domain/usecases/mergeConflicts/notifyConflicts.test.ts`
- Modify: `terraform/environments/dev/main.tf`

- [ ] **Step 1: Write failing WhatsApp notifier tests**

In `apps/code-agent/src/__tests__/infra/services/whatsappNotifier.test.ts`, change `createMockConfig` so tests can pass a configured public app URL.

```typescript
const createMockConfig = (
  overrides: Partial<WhatsAppNotifierConfig> = {}
): WhatsAppNotifierConfig => ({
  whatsappPublisher: mockPublisher,
  linearAgentClient: mockLinearAgentClient as unknown as NonNullable<WhatsAppNotifierConfig['linearAgentClient']>,
  ...overrides,
});
```

Add these tests in `describe('buildTaskUrl', () => { ... })`.

```typescript
it('uses the configured public web app URL for deep links', () => {
  expect(buildTaskUrl('task-123', 'https://dev.intexuraos.cloud')).toBe(
    'https://dev.intexuraos.cloud/#/code-tasks/task-123'
  );
});

it('normalizes a trailing slash in the configured public web app URL', () => {
  expect(buildTaskUrl('task-123', 'https://dev.intexuraos.cloud/')).toBe(
    'https://dev.intexuraos.cloud/#/code-tasks/task-123'
  );
});
```

Add this test in `describe('notifyTaskComplete', () => { ... })`.

```typescript
it('uses configured public web app URL in View Progress CTA', async () => {
  const task = createMockTask({
    result: createMockResult({ prUrl: undefined as unknown as string }),
  });

  const notifier = createWhatsAppNotifier(
    createMockConfig({ webAppUrl: 'https://dev.intexuraos.cloud/' })
  );
  getPublishSendMessageMock().mockResolvedValueOnce(ok(undefined));

  await notifier.notifyTaskComplete('user-123', task);

  const callArgs = getPublishSendMessageMock().mock.calls[0]?.[0];
  expect(callArgs.ctaUrl).toEqual({
    displayText: 'View Progress',
    url: 'https://dev.intexuraos.cloud/#/code-tasks/task-123',
  });
});
```

- [ ] **Step 2: Write failing merge conflict URL tests**

In `apps/code-agent/src/__tests__/domain/usecases/mergeConflicts/notifyConflicts.test.ts`, replace `INTEXURAOS_WEB_URL` with `INTEXURAOS_WEB_APP_URL` in the two `buildTaskUrl` tests.

Add `afterEach` cleanup for any `process.env['INTEXURAOS_WEB_APP_URL']` mutation in this `describe` block so env state does not leak between tests.

```typescript
let originalWebAppUrl: string | undefined;

beforeEach(() => {
  originalWebAppUrl = process.env['INTEXURAOS_WEB_APP_URL'];
});

afterEach(() => {
  if (originalWebAppUrl === undefined) {
    delete process.env['INTEXURAOS_WEB_APP_URL'];
    return;
  }
  process.env['INTEXURAOS_WEB_APP_URL'] = originalWebAppUrl;
});

it('uses INTEXURAOS_WEB_APP_URL when set', () => {
  process.env['INTEXURAOS_WEB_APP_URL'] = 'https://dev.intexuraos.cloud';
  expect(buildTaskUrl('task-1')).toBe('https://dev.intexuraos.cloud/#/code-tasks/task-1');
});
```

Keep the existing fallback test, but delete `INTEXURAOS_WEB_APP_URL` inside the test instead of `INTEXURAOS_WEB_URL`; the shared `afterEach` restores the original value.

- [ ] **Step 3: Run targeted tests and confirm they fail**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/infra/services/whatsappNotifier.test.ts src/__tests__/domain/usecases/mergeConflicts/notifyConflicts.test.ts
```

Expected: FAIL because `buildTaskUrl` does not accept a configured base URL and merge conflict comments still read `INTEXURAOS_WEB_URL`.

- [ ] **Step 4: Add code-agent config wiring**

In `apps/code-agent/src/index.ts`, add `INTEXURAOS_WEB_APP_URL` to `REQUIRED_ENV`.

```typescript
const REQUIRED_ENV = [
  'INTEXURAOS_GCP_PROJECT_ID',
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'INTEXURAOS_WEBHOOK_VERIFY_SECRET',
  'INTEXURAOS_TOKEN_ENCRYPTION_KEY',
  'INTEXURAOS_ORCHESTRATOR_SECRET',
  'INTEXURAOS_GITHUB_WEBHOOK_SECRET',
  'INTEXURAOS_SERVICE_URL',
  'INTEXURAOS_WEB_APP_URL',
];
```

Update the optional-env comment in the same file so it names the canonical variable.

```typescript
 * - INTEXURAOS_WEB_APP_URL: Public web app URL for generating user-facing links
```

In `apps/code-agent/src/config.ts`, add `webAppUrl` to `Config`, load it, and return it. Because `INTEXURAOS_WEB_APP_URL` is now required at startup, do not coerce a missing value to `''`; read it as a non-empty required string.

```typescript
export interface Config {
  port: number;
  gcpProjectId: string;
  internalAuthToken: string;
  firestoreProjectId: string;
  whatsappServiceUrl: string;
  whatsappSendTopic: string;
  prTriageTopic: string;
  linearAgentUrl: string;
  actionsAgentUrl: string;
  webhookVerifySecret: string;
  tokenEncryptionKey: string;
  orchestratorSecret: string;
  serviceUrl: string;
  webAppUrl: string;
  githubWebhookSecret: string;
  userServiceUrl: string;
  // existing fields remain unchanged
}
```

```typescript
function readRequiredStringEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

const webAppUrl = readRequiredStringEnv('INTEXURAOS_WEB_APP_URL');
```

```typescript
return {
  port,
  gcpProjectId,
  internalAuthToken,
  firestoreProjectId,
  whatsappServiceUrl,
  whatsappSendTopic,
  prTriageTopic,
  linearAgentUrl,
  actionsAgentUrl,
  webhookVerifySecret,
  orchestratorSecret,
  serviceUrl,
  webAppUrl,
  tokenEncryptionKey,
  githubWebhookSecret,
  userServiceUrl,
  // existing return fields remain unchanged
};
```

In `apps/code-agent/src/services/types.ts`, add the same field to `ServiceConfig`.

```typescript
export interface ServiceConfig {
  gcpProjectId: string;
  internalAuthToken: string;
  firestoreProjectId: string;
  whatsappServiceUrl: string;
  whatsappSendTopic: string;
  prTriageTopic: string;
  linearAgentUrl: string;
  actionsAgentUrl: string;
  webhookVerifySecret: string;
  orchestratorSecret: string;
  serviceUrl: string;
  webAppUrl: string;
  userServiceUrl: string;
  openRouterAppApiKey: string;
  openaiAppApiKey: string;
  llmUsageServiceUrl: string;
}
```

In `apps/code-agent/src/services.ts`, pass the configured URL to the notifier.

```typescript
const whatsappNotifier = createWhatsAppNotifier({
  whatsappPublisher,
  linearAgentClient,
  webAppUrl: config.webAppUrl,
});
```

In `apps/code-agent/src/index.ts`, update the `initServices({...})` call so the required `ServiceConfig.webAppUrl` value is passed through at startup.

```typescript
initServices({
  gcpProjectId: config.gcpProjectId,
  internalAuthToken: config.internalAuthToken,
  firestoreProjectId: config.firestoreProjectId,
  whatsappServiceUrl: config.whatsappServiceUrl,
  whatsappSendTopic: config.whatsappSendTopic,
  prTriageTopic: config.prTriageTopic,
  linearAgentUrl: config.linearAgentUrl,
  actionsAgentUrl: config.actionsAgentUrl,
  webhookVerifySecret: config.webhookVerifySecret,
  orchestratorSecret: config.orchestratorSecret,
  serviceUrl: config.serviceUrl,
  webAppUrl: config.webAppUrl,
  userServiceUrl: config.userServiceUrl,
  openRouterAppApiKey: config.openRouterAppApiKey,
  openaiAppApiKey: config.openaiAppApiKey,
  llmUsageServiceUrl: config.llmUsageServiceUrl,
});
```

Update every test helper that constructs a complete `ServiceConfig` object so TypeScript continues compiling after `webAppUrl` becomes required. Add this default to the `makeConfig()` return object in:

- `apps/code-agent/src/__tests__/services/factories/services.test.ts`
- `apps/code-agent/src/__tests__/services/factories/clientFactory.test.ts`
- `apps/code-agent/src/__tests__/services/factories/publisherFactory.test.ts`
- `apps/code-agent/src/__tests__/services/factories/llmFactory.test.ts`

```typescript
webAppUrl: 'https://dev.intexuraos.cloud',
```

- [ ] **Step 5: Change WhatsApp notifier URL construction**

In `apps/code-agent/src/infra/services/whatsappNotifierImpl.ts`, replace the hardcoded `APP_BASE_URL` with a configurable base URL.

```typescript
const DEFAULT_WEB_APP_URL = 'https://intexuraos.cloud';

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function buildTaskUrl(
  taskId: string,
  webAppUrl: string = DEFAULT_WEB_APP_URL
): string {
  return `${stripTrailingSlash(webAppUrl)}/#/code-tasks/${taskId}`;
}
```

Extend `WhatsAppNotifierConfig`.

```typescript
export interface WhatsAppNotifierConfig {
  whatsappPublisher: WhatsAppSendPublisher;
  linearAgentClient?: LinearAgentClient;
  webAppUrl?: string;
}
```

Inside `createWhatsAppNotifier`, capture a non-empty configured base. This avoids the empty-string fallback trap where `'' ?? DEFAULT_WEB_APP_URL` would keep `''` and generate malformed hash-only URLs.

```typescript
export function createWhatsAppNotifier(config: WhatsAppNotifierConfig): WhatsAppNotifier {
  const { whatsappPublisher, linearAgentClient } = config;
  const webAppUrl =
    config.webAppUrl !== undefined && config.webAppUrl.length > 0
      ? config.webAppUrl
      : DEFAULT_WEB_APP_URL;
```

Update `buildCtaUrl` and all direct `buildTaskUrl(...)` calls in the notifier to pass `webAppUrl`.

```typescript
function buildCtaUrl(task: CodeTask, webAppUrl: string): { displayText: string; url: string } {
  const prUrl = task.result?.prUrl;
  if (prUrl !== undefined && prUrl.length > 0) {
    return { displayText: 'View Pull Request', url: prUrl };
  }
  return { displayText: 'View Progress', url: buildTaskUrl(task.id, webAppUrl) };
}
```

Example direct call update:

```typescript
ctaUrl: { displayText: 'View Task', url: buildTaskUrl(task.id, webAppUrl) },
```

Apply that same pattern to task failed, started, resumed, queued, queue expired, auto-retried, and auto-retry-exhausted CTA URLs.

- [ ] **Step 6: Update merge conflict task links to the canonical env var**

In `apps/code-agent/src/domain/usecases/mergeConflicts/notifyConflicts.ts`, use `INTEXURAOS_WEB_APP_URL`.

```typescript
const DEFAULT_WEB_APP_URL = 'https://intexuraos.cloud';

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function buildTaskUrl(taskId: string): string {
  const configuredWebUrl = process.env['INTEXURAOS_WEB_APP_URL'];
  const webUrl =
    configuredWebUrl !== undefined && configuredWebUrl.length > 0
      ? configuredWebUrl
      : DEFAULT_WEB_APP_URL;
  return `${stripTrailingSlash(webUrl)}/#/code-tasks/${taskId}`;
}
```

- [ ] **Step 7: Add code-agent Terraform env wiring**

In `terraform/environments/dev/main.tf`, add the public web app URL to `module "code_agent"` `env_vars`.

```hcl
env_vars = merge(local.common_service_env_vars, {
  INTEXURAOS_SERVICE_URL                = "https://${local.services.code_agent.name}-${local.cloud_run_url_suffix}"
  INTEXURAOS_WEB_APP_URL                = "https://${var.web_app_domain}"
  INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC = "intexuraos-whatsapp-send-${var.environment}"
  INTEXURAOS_PUBSUB_PR_TRIAGE_TOPIC     = "intexuraos-pr-triage-${var.environment}"
  INTEXURAOS_EXECUTION_MEMORY_ENABLED   = "true"
  INTEXURAOS_QUEUE_MAX_SIZE             = "50"
  INTEXURAOS_QUEUE_TTL_MINUTES          = "1440"
  INTEXURAOS_RETRY_QUEUE_MAX_ATTEMPTS   = "3"
  INTEXURAOS_RETRY_QUEUE_TTL_MINUTES    = "10"
  INTEXURAOS_AUTO_RETRY_MAX_ATTEMPTS    = "3"
  INTEXURAOS_ENABLE_METRICS             = "true"
})
```

- [ ] **Step 8: Run targeted tests and confirm they pass**

Run:

```bash
pnpm --filter @intexuraos/code-agent test -- src/__tests__/infra/services/whatsappNotifier.test.ts src/__tests__/domain/usecases/mergeConflicts/notifyConflicts.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run code-agent verification**

Run:

```bash
pnpm run verify:workspace:tracked -- code-agent
```

Expected: PASS.

- [ ] **Step 10: Commit Task 2**

Run:

```bash
git add apps/code-agent/src/index.ts apps/code-agent/src/config.ts apps/code-agent/src/services/types.ts apps/code-agent/src/services.ts apps/code-agent/src/infra/services/whatsappNotifierImpl.ts apps/code-agent/src/__tests__/infra/services/whatsappNotifier.test.ts apps/code-agent/src/domain/usecases/mergeConflicts/notifyConflicts.ts apps/code-agent/src/__tests__/domain/usecases/mergeConflicts/notifyConflicts.test.ts terraform/environments/dev/main.tf
git commit -m "fix(INT-1638): build code task links from web app URL"
```

---

### Task 3: Audit Link Producers And Run Final Verification

**Files:**

- Verify: `apps/actions-agent/src/domain/usecases/`
- Verify: `apps/mobile-notifications-service/src/`
- Verify: `apps/research-agent/src/`
- Verify: `apps/web/src/App.tsx`
- Verify: `ecosystem.config.cjs`
- Verify: `terraform/environments/dev/main.tf`

- [ ] **Step 1: Audit WhatsApp link builders**

Run:

```bash
rg -n "INTEXURAOS_WEB_APP_URL|INTEXURAOS_WEB_URL|http://localhost:3000|https://intexuraos.cloud|ctaUrl|View it here" apps/actions-agent/src apps/code-agent/src apps/mobile-notifications-service/src apps/research-agent/src ecosystem.config.cjs terraform/environments/dev/main.tf
```

Expected findings after Tasks 1-2:

- `ecosystem.config.cjs` uses `https://dev.intexuraos.cloud` as the `INTEXURAOS_WEB_APP_URL` fallback.
- `ecosystem.config.cjs` has no `actions-agent` service-specific `INTEXURAOS_WEB_APP_URL` override pointing at `http://localhost:3000`; `actions-agent` inherits the common dev fallback or has an explicitly aligned `https://dev.intexuraos.cloud` fallback.
- `apps/actions-agent/src/index.ts` still requires `INTEXURAOS_WEB_APP_URL` and passes it to services.
- `apps/actions-agent/src/domain/usecases/*` use injected `webAppUrl`, not localhost literals, for user-facing WhatsApp links.
- `apps/mobile-notifications-service/src/services.ts` uses `INTEXURAOS_WEB_APP_URL`.
- `apps/research-agent/src/index.ts` and `apps/research-agent/src/services.ts` use `INTEXURAOS_WEB_APP_URL`.
- `apps/code-agent/src/infra/services/whatsappNotifierImpl.ts` does not contain a hardcoded `APP_BASE_URL`.
- `apps/code-agent/src/domain/usecases/mergeConflicts/notifyConflicts.ts` does not use `INTEXURAOS_WEB_URL`.

- [ ] **Step 2: Reconfirm web routes**

Run:

```bash
rg -n 'path="/code-tasks/:id"|path="/inbox"|path="/research/:id"|path="/notifications/digests/:groupKey/:date"' apps/web/src/App.tsx
```

Expected: all four routes are present.

- [ ] **Step 3: Run affected targeted tests**

Run:

```bash
pnpm exec vitest run scripts/__tests__/ecosystem.config.test.ts
pnpm --filter @intexuraos/code-agent test -- src/__tests__/infra/services/whatsappNotifier.test.ts src/__tests__/domain/usecases/mergeConflicts/notifyConflicts.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run tracked CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: PASS.

- [ ] **Step 5: Commit verification-only fixes if CI exposes any**

If CI exposes a failure caused by this change, fix it with the same test-first pattern, rerun `pnpm run ci:tracked`, and commit the fix.

Use commit message:

```bash
git commit -m "fix(INT-1638): complete WhatsApp dev link verification"
```

Skip this commit when Step 4 passes without further edits.

## Acceptance Criteria

- Dev PM2 services that produce WhatsApp user-facing links receive `INTEXURAOS_WEB_APP_URL=https://dev.intexuraos.cloud` when no shell override is set.
- Production Cloud Run code-agent receives `INTEXURAOS_WEB_APP_URL=https://${var.web_app_domain}` like the other link-producing services.
- Code-agent WhatsApp CTA URLs for task progress use the configured public web app URL.
- Existing absolute external URLs such as GitHub PR URLs and Google Calendar URLs remain unchanged.
- No WhatsApp notification path uses `http://localhost:3000` as the public URL in the dev environment.
- Empty-string `INTEXURAOS_WEB_APP_URL` values fall back to `https://intexuraos.cloud` in code-agent URL builders instead of producing malformed `/#/code-tasks/...` links.
- The final implementation passes `pnpm run ci:tracked`.
