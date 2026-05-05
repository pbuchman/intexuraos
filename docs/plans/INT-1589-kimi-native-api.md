# Native Kimi Code API Worker Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the existing `kimi` code-worker type to the native Kimi Code API with a dedicated Kimi.com API key, stable `kimi-for-coding` model ID, and thinking mode enabled, without changing user-facing worker type names.

**Architecture:** Keep `kimi` on the existing Claude-compatible worker runtime because the code-worker image already runs Claude Code and `WORKER_TYPES.kimi` is a Claude-runtime provider configuration. Replace only the provider base URL, model ID, API-key source, and effort/thinking settings; keep `glm` and `qwen` on DashScope/Alibaba. Add a dedicated `KIMI_API_KEY` worker secret sourced from host env `INTEXURAOS_KIMI_APP_API_KEY`.

**Tech Stack:** TypeScript, Vitest, orchestrator Docker isolation, Terraform Secret Manager definitions, PM2 ecosystem env wiring, Kimi Code API.

---

## Decisions

- Keep the public worker type key as `kimi`; do not change `CODE_TASK_WORKER_TYPES`, web copy, labels, or settings UI names.
- Use `model: 'kimi-for-coding'` for every Kimi worker request.
- Use host env `INTEXURAOS_KIMI_APP_API_KEY` and container secret key `KIMI_API_KEY`; do not reuse `INTEXURAOS_DASHSCOPE_APP_API_KEY`.
- Set the test value to `ABCDEFG` in the dev env surface used by orchestrator.
- Keep `apiBaseUrl` as `https://api.kimi.com/coding` for the Claude/Anthropic-compatible runtime. The current code appends `/v1/messages`, so the effective request endpoint is `https://api.kimi.com/coding/v1/messages`. Do not set `ANTHROPIC_BASE_URL` to `https://api.kimi.com/coding/v1`, because that would make the existing validator and likely Claude Code construct `/coding/v1/v1/messages`.
- Enable thinking mode by setting `effort: 'high'`, which makes `buildWorkerEnv()` emit `CLAUDE_CODE_EFFORT_LEVEL=high` for the Claude Code runtime.

Official Kimi Code docs reference: https://www.kimi.com/code/docs/en/

## Endpoint Changes

Modified:
- Kimi worker upstream Anthropic-compatible base changes from `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic` to `https://api.kimi.com/coding`.

Created:
- No IntexuraOS HTTP endpoints.

Removed:
- No IntexuraOS HTTP endpoints.

Unchanged:
- User-facing worker type values and all code-agent/web worker settings endpoints.
- `glm` and `qwen` continue using DashScope/Alibaba.

## File Structure

- Modify `workers/orchestrator/src/services/isolation/types.ts`: add the `KIMI_API_KEY` worker secret key and update only the `kimi` worker config.
- Modify `workers/orchestrator/src/services/isolation/__tests__/types.test.ts`: assert the Kimi native provider config and secret-key contract.
- Modify `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`: assert Kimi containers receive the dedicated key, Kimi base URL, stable model, and thinking effort env vars.
- Modify `workers/orchestrator/src/services/isolation/__tests__/e2e-container.test.ts`: update the `WorkerSecrets` fixture with `KIMI_API_KEY`.
- Modify `workers/orchestrator/src/bootstrap/env-config.ts`: read `INTEXURAOS_KIMI_APP_API_KEY` into `BootstrapEnvConfig`.
- Modify `workers/orchestrator/src/__tests__/bootstrap/env-config.test.ts`: require and surface the Kimi host env var.
- Modify `workers/orchestrator/src/bootstrap/service-wiring.ts`: copy `env.kimiApiKey` into `WorkerSecrets.KIMI_API_KEY`.
- Modify `workers/orchestrator/src/bootstrap/api-key-validator.ts`: validate the Kimi key through the `kimi` worker config instead of validating Kimi through DashScope.
- Modify `workers/orchestrator/src/__tests__/bootstrap/api-key-validator.test.ts`: update validation input shapes for `kimiKey`.
- Modify `workers/orchestrator/src/start.ts`: pass `kimiKey` into startup validation.
- Modify `workers/orchestrator/src/__tests__/start.test.ts`: update mocked env configs and startup validation assertions.
- Modify `workers/orchestrator/src/services/task-dispatcher.ts`: ensure `IsolationConfig.getSecrets()` returns the full `WorkerSecrets` contract including `KIMI_API_KEY`.
- Modify `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`: update task dispatcher secret fixtures with `KIMI_API_KEY`.
- Modify `workers/orchestrator/src/services/task-dispatcher/__tests__/fixtures.ts`: update shared dispatcher fixtures with `KIMI_API_KEY`.
- Modify `workers/orchestrator/src/__tests__/services/task-dispatcher/metrics-emission.test.ts`: update metrics fixture secrets with `KIMI_API_KEY`.
- Modify `terraform/environments/dev/main.tf`: add the Kimi Secret Manager secret definition.
- Modify `ecosystem.config.cjs`: expose `INTEXURAOS_KIMI_APP_API_KEY` to dev process env in the same group as other LLM provider keys.
- Populate `.envrc` via Secret Manager sync with temporary test value `ABCDEFG`; `.envrc` is intentionally ignored and must not be committed.
- Modify `workers/orchestrator/README.md`: document the required Kimi API key env var for orchestrator setup.

### Task 1: Lock The Native Kimi Worker Type Contract

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/__tests__/types.test.ts`
- Modify: `workers/orchestrator/src/services/isolation/types.ts`

- [ ] **Step 1: Write the failing worker-type config test**

Replace the existing Kimi model test in `workers/orchestrator/src/services/isolation/__tests__/types.test.ts`:

```typescript
  it('routes kimi to native Kimi Code API using stable coding model with thinking enabled', () => {
    expect(WORKER_TYPES.kimi.runtime).toBe('claude');
    expect(WORKER_TYPES.kimi.apiBaseUrl).toBe('https://api.kimi.com/coding');
    expect(WORKER_TYPES.kimi.apiKeyEnvVar).toBe('KIMI_API_KEY');
    expect(WORKER_TYPES.kimi.model).toBe('kimi-for-coding');
    expect(WORKER_TYPES.kimi.effort).toBe('high');
  });
```

In the `workerSecretsKeys` set in the same file, add `KIMI_API_KEY`:

```typescript
    const workerSecretsKeys: ReadonlySet<string> = new Set<keyof WorkerSecrets>([
      'ANTHROPIC_API_KEY',
      'LINEAR_API_KEY',
      'SENTRY_AUTH_TOKEN',
      'MINIMAX_API_KEY',
      'MIMO_API_KEY',
      'DASHSCOPE_API_KEY',
      'KIMI_API_KEY',
      'OPENROUTER_API_KEY',
    ]);
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
pnpm --filter orchestrator test -- src/services/isolation/__tests__/types.test.ts
```

Expected: FAIL because `WORKER_TYPES.kimi` still has DashScope base URL, `DASHSCOPE_API_KEY`, and `kimi-k2.5`.

- [ ] **Step 3: Update the worker config and secret types**

In `workers/orchestrator/src/services/isolation/types.ts`, extend the `apiKeyEnvVar` union:

```typescript
  apiKeyEnvVar?:
    | 'ANTHROPIC_API_KEY'
    | 'MINIMAX_API_KEY'
    | 'MIMO_API_KEY'
    | 'DASHSCOPE_API_KEY'
    | 'KIMI_API_KEY'
    | 'OPENROUTER_API_KEY';
```

Replace the `kimi` config:

```typescript
  kimi: {
    runtime: 'claude',
    apiBaseUrl: 'https://api.kimi.com/coding',
    apiKeyEnvVar: 'KIMI_API_KEY',
    model: 'kimi-for-coding',
    effort: 'high',
    telemetryExpectation: 'optional',
  },
```

Add `KIMI_API_KEY` to `WorkerSecrets`:

```typescript
export interface WorkerSecrets {
  ANTHROPIC_API_KEY: string;
  LINEAR_API_KEY: string;
  SENTRY_AUTH_TOKEN: string;
  MINIMAX_API_KEY: string;
  MIMO_API_KEY: string;
  DASHSCOPE_API_KEY: string;
  KIMI_API_KEY: string;
  OPENROUTER_API_KEY: string;
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
pnpm --filter orchestrator test -- src/services/isolation/__tests__/types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Leave the worker type changes uncommitted for the final commit**

Do not commit yet. This repo requires `pnpm run ci:tracked` before every commit, so commit only once in Task 5 after full tracked CI passes.

Run the next task.

### Task 2: Prove Kimi Container Env Uses The Dedicated Key

**Files:**
- Modify: `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`
- Modify: `workers/orchestrator/src/services/isolation/__tests__/e2e-container.test.ts`
- Modify: `workers/orchestrator/src/bootstrap/service-wiring.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Modify: `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`
- Modify: `workers/orchestrator/src/services/task-dispatcher/__tests__/fixtures.ts`
- Modify: `workers/orchestrator/src/__tests__/services/task-dispatcher/metrics-emission.test.ts`

- [ ] **Step 1: Add the Kimi key to the Docker provider test fixture**

In `createTestConfig()` in `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`, add:

```typescript
    KIMI_API_KEY: 'test-kimi-key',
```

The full `secrets` object should include:

```typescript
  secrets: {
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    LINEAR_API_KEY: 'test-linear-key',
    SENTRY_AUTH_TOKEN: 'test-sentry-token',
    MINIMAX_API_KEY: 'test-minimax-key',
    MIMO_API_KEY: 'test-mimo-key',
    DASHSCOPE_API_KEY: 'test-dashscope-key',
    KIMI_API_KEY: 'test-kimi-key',
    OPENROUTER_API_KEY: 'test-openrouter-key',
  },
```

- [ ] **Step 2: Add the Kimi key to every non-Docker `WorkerSecrets` fixture**

Update every test fixture that constructs the full worker secret shape:

```typescript
    KIMI_API_KEY: 'test-kimi-key',
```

Required fixture files:
- `workers/orchestrator/src/services/isolation/__tests__/e2e-container.test.ts`
- `workers/orchestrator/src/__tests__/task-dispatcher.test.ts`
- `workers/orchestrator/src/services/task-dispatcher/__tests__/fixtures.ts`
- `workers/orchestrator/src/__tests__/services/task-dispatcher/metrics-emission.test.ts`

- [ ] **Step 3: Add the failing Kimi env test**

Add this test near the existing third-party provider env tests in `workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts`:

```typescript
    it('sets native Kimi Code env vars for kimi worker', async () => {
      const config = createTestConfig({ workerType: 'kimi' });
      await sharedCredsProvider.createWorker(config);

      const createCall = mocks.mockDocker.createContainer.mock.calls[0]?.[0];
      const envArr = createCall?.Env as string[];

      expect(envArr.find((e: string) => e.startsWith('ANTHROPIC_API_KEY='))).toBe(
        'ANTHROPIC_API_KEY=test-kimi-key'
      );
      expect(envArr.find((e: string) => e.startsWith('ANTHROPIC_BASE_URL='))).toBe(
        'ANTHROPIC_BASE_URL=https://api.kimi.com/coding'
      );
      expect(envArr.find((e: string) => e.startsWith('ANTHROPIC_MODEL='))).toBe(
        'ANTHROPIC_MODEL=kimi-for-coding'
      );
      expect(envArr.find((e: string) => e.startsWith('CLAUDE_CODE_EFFORT_LEVEL='))).toBe(
        'CLAUDE_CODE_EFFORT_LEVEL=high'
      );
    });
```

- [ ] **Step 4: Run the focused Docker provider test and confirm it fails**

Run:

```bash
pnpm --filter orchestrator test -- src/services/isolation/__tests__/docker-provider.test.ts -t "native Kimi Code env vars"
```

Expected: FAIL until Task 1 implementation is present and the service wiring compiles with `KIMI_API_KEY`.

- [ ] **Step 5: Wire `env.kimiApiKey` into worker secrets**

In `workers/orchestrator/src/bootstrap/service-wiring.ts`, update `apiKeySecrets`:

```typescript
  const apiKeySecrets = {
    ANTHROPIC_API_KEY: workerAuthRegistry.getCurrentAccessToken('claude') ?? '',
    LINEAR_API_KEY: env.linearApiKey,
    SENTRY_AUTH_TOKEN: env.sentryAuthToken,
    MINIMAX_API_KEY: env.minimaxApiKey,
    MIMO_API_KEY: env.mimoApiKey,
    DASHSCOPE_API_KEY: env.dashscopeApiKey,
    KIMI_API_KEY: env.kimiApiKey,
    OPENROUTER_API_KEY: env.openRouterApiKey,
  };
```

- [ ] **Step 6: Keep dispatcher secret handoffs typed against the full worker contract**

In `workers/orchestrator/src/services/task-dispatcher.ts`, ensure `IsolationConfig.getSecrets()` returns the complete `WorkerSecrets` shape after adding `KIMI_API_KEY`, because its value is passed directly into `WorkerConfig.secrets`.

- [ ] **Step 7: Run the focused Docker provider test and confirm it passes**

Run:

```bash
pnpm --filter orchestrator test -- src/services/isolation/__tests__/docker-provider.test.ts -t "native Kimi Code env vars"
```

Expected: PASS.

- [ ] **Step 8: Leave the container env changes uncommitted for the final commit**

Do not commit yet. This repo requires `pnpm run ci:tracked` before every commit, so commit only once in Task 5 after full tracked CI passes.

Run the next task.

### Task 3: Add Host Env And Startup Validation Plumbing

**Files:**
- Modify: `workers/orchestrator/src/bootstrap/env-config.ts`
- Modify: `workers/orchestrator/src/__tests__/bootstrap/env-config.test.ts`
- Modify: `workers/orchestrator/src/bootstrap/api-key-validator.ts`
- Modify: `workers/orchestrator/src/__tests__/bootstrap/api-key-validator.test.ts`
- Modify: `workers/orchestrator/src/start.ts`
- Modify: `workers/orchestrator/src/__tests__/start.test.ts`

- [ ] **Step 1: Update env-config tests first**

In `makeValidEnv()` in `workers/orchestrator/src/__tests__/bootstrap/env-config.test.ts`, add:

```typescript
    INTEXURAOS_KIMI_APP_API_KEY: 'ABCDEFG',
```

In the "returns a typed config object when all required vars are set" test, add:

```typescript
    expect(config.kimiApiKey).toBe('ABCDEFG');
```

- [ ] **Step 2: Run env-config tests and confirm they fail**

Run:

```bash
pnpm --filter orchestrator test -- src/__tests__/bootstrap/env-config.test.ts
```

Expected: FAIL because `BootstrapEnvConfig` does not expose `kimiApiKey`.

- [ ] **Step 3: Implement env-config Kimi key loading**

In `workers/orchestrator/src/bootstrap/env-config.ts`, add this field to `BootstrapEnvConfig`:

```typescript
  kimiApiKey: string;
```

After `dashscopeApiKey`, read the required env var:

```typescript
  const kimiApiKey = getRequiredEnv('INTEXURAOS_KIMI_APP_API_KEY', env);
```

Return it with the other provider keys:

```typescript
    dashscopeApiKey,
    kimiApiKey,
    openRouterApiKey,
```

- [ ] **Step 4: Update API-key validation types and call sites**

In `workers/orchestrator/src/bootstrap/api-key-validator.ts`, extend `WorkerApiKeysForValidation`:

```typescript
export interface WorkerApiKeysForValidation {
  minimaxKey: string;
  mimoKey: string;
  dashscopeKey: string;
  kimiKey: string;
  openRouterKey: string;
}
```

Update the validation comment:

```typescript
  // Validate all third-party API keys in parallel.
  // GLM and Qwen use the DashScope API key; Kimi uses its own native Kimi Code key.
```

Update the `Promise.all()` fan-out:

```typescript
    keys.dashscopeKey !== ''
      ? validateThirdPartyApiKey('qwen', keys.dashscopeKey, logger)
      : Promise.resolve(),
    keys.kimiKey !== ''
      ? validateThirdPartyApiKey('kimi', keys.kimiKey, logger)
      : Promise.resolve(),
    keys.openRouterKey !== ''
      ? validateThirdPartyApiKey('openrouter-free', keys.openRouterKey, logger)
      : Promise.resolve(),
```

In `workers/orchestrator/src/__tests__/bootstrap/api-key-validator.test.ts`, update the `noKeys` fixture:

```typescript
  const noKeys = {
    minimaxKey: '',
    mimoKey: '',
    dashscopeKey: '',
    kimiKey: '',
    openRouterKey: '',
  };
```

- [ ] **Step 5: Update `start.ts` validation call**

In `workers/orchestrator/src/start.ts`, pass the new key:

```typescript
      minimaxKey: env.minimaxApiKey,
      mimoKey: env.mimoApiKey,
      dashscopeKey: env.dashscopeApiKey,
      kimiKey: env.kimiApiKey,
      openRouterKey: env.openRouterApiKey,
```

- [ ] **Step 6: Update `start.test.ts` mocked env configs**

In every mocked `BootstrapEnvConfig` object in `workers/orchestrator/src/__tests__/start.test.ts`, add:

```typescript
      kimiApiKey: 'ABCDEFG',
```

Add a focused assertion in the "invokes every bootstrap module exactly once" test after `await start()`:

```typescript
    expect(validateWorkerApiKeys).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kimiKey: 'ABCDEFG' }),
      expect.anything()
    );
```

- [ ] **Step 7: Run the focused bootstrap tests**

Run:

```bash
pnpm --filter orchestrator test -- src/__tests__/bootstrap/env-config.test.ts src/__tests__/bootstrap/api-key-validator.test.ts src/__tests__/start.test.ts
```

Expected: PASS.

- [ ] **Step 8: Leave the env and validation plumbing changes uncommitted for the final commit**

Do not commit yet. This repo requires `pnpm run ci:tracked` before every commit, so commit only once in Task 5 after full tracked CI passes.

Run the next task.

### Task 4: Add Deployment Env Surfaces And Test Value

**Files:**
- Modify: `terraform/environments/dev/main.tf`
- Modify: `ecosystem.config.cjs`
- Modify: `.envrc`
- Modify: `workers/orchestrator/README.md`

- [ ] **Step 1: Add the Terraform Secret Manager entry**

In `terraform/environments/dev/main.tf`, add this under the LLM API keys in `module "secret_manager"`:

```hcl
    "INTEXURAOS_KIMI_APP_API_KEY"      = "Kimi Code API key for orchestrator kimi worker containers"
```

In `local.common_service_secrets`, add the same secret ID near `INTEXURAOS_DASHSCOPE_APP_API_KEY`:

```hcl
    INTEXURAOS_KIMI_APP_API_KEY      = module.secret_manager.secret_ids["INTEXURAOS_KIMI_APP_API_KEY"]
```

Place it near `INTEXURAOS_DASHSCOPE_APP_API_KEY`.

- [ ] **Step 2: Add the PM2/dev env mapping**

In `ecosystem.config.cjs`, add the env var near the other LLM provider keys:

```javascript
  INTEXURAOS_KIMI_APP_API_KEY: process.env.INTEXURAOS_KIMI_APP_API_KEY,
```

- [ ] **Step 3: Add the temporary test key value**

Set the temporary test value in GCP Secret Manager for the shared project when applying the change:

```bash
printf '%s' 'ABCDEFG' | gcloud secrets versions add INTEXURAOS_KIMI_APP_API_KEY --data-file=- --project=intexuraos-dev-pbuchman
```

Run the `gcloud secrets versions add` command only after Terraform has created `INTEXURAOS_KIMI_APP_API_KEY` or after confirming the secret already exists.

Then regenerate the ignored `.envrc` from Secret Manager:

```bash
PROJECT_ID=intexuraos-dev-pbuchman ./scripts/sync-secrets.sh
```

Do not commit `.envrc`; it contains synced secret values and is excluded by `.gitignore`.

- [ ] **Step 4: Document the required orchestrator env var**

In `workers/orchestrator/README.md`, add a required env var row near the existing provider keys:

```markdown
| `INTEXURAOS_KIMI_APP_API_KEY`       | `.envrc`       | Kimi Code API key for the `kimi` worker type      |
```

- [ ] **Step 5: Validate Terraform secret wiring**

Run:

```bash
pnpm run verify:terraform-secrets
```

Expected: PASS.

- [ ] **Step 6: Leave deployment env surface changes uncommitted for the final commit**

Do not commit yet. This repo requires `pnpm run ci:tracked` before every commit, so commit only once in Task 5 after full tracked CI passes.

Run the final audit task.

### Task 5: Final Audit And CI

**Files:**
- Verify: `workers/orchestrator/src/services/isolation/types.ts`
- Verify: `workers/orchestrator/src/bootstrap/env-config.ts`
- Verify: `workers/orchestrator/src/bootstrap/service-wiring.ts`
- Verify: `workers/orchestrator/src/services/task-dispatcher.ts`
- Verify: `workers/orchestrator/src/bootstrap/api-key-validator.ts`
- Verify: `workers/orchestrator/src/start.ts`
- Verify: `terraform/environments/dev/main.tf`
- Verify: `ecosystem.config.cjs`
- Verify: `PROJECT_ID=intexuraos-dev-pbuchman ./scripts/sync-secrets.sh --output /tmp/int-1589.envrc`

- [ ] **Step 1: Audit for stale Kimi DashScope references**

Run:

```bash
rg -n "kimi-k2\\.5|WORKER_TYPES\\.kimi|kimi.*DASHSCOPE|DASHSCOPE.*kimi|coding-intl\\.dashscope.*kimi|INTEXURAOS_KIMI_APP_API_KEY|KIMI_API_KEY" workers/orchestrator terraform/environments/dev/main.tf ecosystem.config.cjs workers/orchestrator/README.md docs/plans/INT-1589-kimi-native-api.md
```

Expected:
- No active code maps `kimi` to DashScope or `kimi-k2.5`.
- `glm` and `qwen` still map to DashScope.
- `INTEXURAOS_KIMI_APP_API_KEY` appears in env config, tests, deployment config, and docs.
- `KIMI_API_KEY` appears in worker secret typing, service wiring, dispatcher handoffs, and every test fixture that constructs `WorkerSecrets`.

- [ ] **Step 2: Audit every `WorkerSecrets` consumer and producer**

Run:

```bash
rg -n "WorkerSecrets|secrets: \{|getSecrets\(|KIMI_API_KEY" workers/orchestrator/src
```

Expected:
- Every object typed as `WorkerSecrets` includes `KIMI_API_KEY`.
- Every `IsolationConfig.getSecrets()` implementation returns `KIMI_API_KEY`.
- Every `WorkerConfig.secrets` fixture and handoff includes the new key.

- [ ] **Step 3: Run targeted orchestrator verification**

Run:

```bash
pnpm run verify:workspace:tracked -- orchestrator
```

Expected: PASS.

- [ ] **Step 4: Run full tracked CI**

Run:

```bash
pnpm run ci:tracked
```

Expected: PASS.

- [ ] **Step 5: Commit, push, and open the implementation PR**

Run:

```bash
git add workers/orchestrator/src/services/isolation/types.ts workers/orchestrator/src/services/isolation/__tests__/types.test.ts
git add workers/orchestrator/src/services/isolation/__tests__/docker-provider.test.ts workers/orchestrator/src/services/isolation/__tests__/e2e-container.test.ts workers/orchestrator/src/bootstrap/service-wiring.ts
git add workers/orchestrator/src/bootstrap/env-config.ts workers/orchestrator/src/__tests__/bootstrap/env-config.test.ts workers/orchestrator/src/bootstrap/api-key-validator.ts workers/orchestrator/src/__tests__/bootstrap/api-key-validator.test.ts workers/orchestrator/src/start.ts workers/orchestrator/src/__tests__/start.test.ts
git add workers/orchestrator/src/services/task-dispatcher.ts workers/orchestrator/src/__tests__/task-dispatcher.test.ts workers/orchestrator/src/services/task-dispatcher/__tests__/fixtures.ts workers/orchestrator/src/__tests__/services/task-dispatcher/metrics-emission.test.ts
git add terraform/environments/dev/main.tf ecosystem.config.cjs workers/orchestrator/README.md docs/plans/INT-1589-kimi-native-api.md
git commit -m "fix(orchestrator): route kimi worker to native api"
git push -u origin HEAD
gh pr create --base development --title "[INT-1589] Update Kimi worker native API config" --body "Fixes INT-1589

## Summary
- Routes the existing kimi worker type to the native Kimi Code API.
- Uses the dedicated Kimi Code API key and stable kimi-for-coding model ID.
- Enables thinking mode through Claude Code effort env wiring.
- Leaves UI worker type naming unchanged.

## Verification
- pnpm run verify:workspace:tracked -- orchestrator
- pnpm run ci:tracked"
```

Expected: PR opens against `development`.
