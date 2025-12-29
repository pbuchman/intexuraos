# Task 6-0: Create API Keys Service Client

**Tier:** 6 (Frontend — depends on backend Tier 2)

---

## Context Snapshot

- Backend endpoints exist for LLM API keys (Tier 2)
- Need frontend service client for settings
- Following patterns from existing service clients in web app

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Create TypeScript service client for managing LLM API keys from the frontend.

---

## Scope

**In scope:**

- Types for API key management
- Service functions: getLlmKeys, setLlmKey, deleteLlmKey
- Integration with useApiClient hook

**Non-scope:**

- UI components (task 6-1)
- Research API (task 6-2)

---

## Required Approach

### Step 1: Create types file

`apps/web/src/services/llmKeysApi.types.ts`:

```typescript
export type LlmProvider = 'google' | 'openai' | 'anthropic';

export interface LlmKeysResponse {
  google: string | null;
  openai: string | null;
  anthropic: string | null;
}

export interface SetLlmKeyRequest {
  provider: LlmProvider;
  apiKey: string;
}

export interface SetLlmKeyResponse {
  provider: LlmProvider;
  masked: string;
}
```

### Step 2: Create service file

`apps/web/src/services/llmKeysApi.ts`:

```typescript
import type {
  LlmProvider,
  LlmKeysResponse,
  SetLlmKeyRequest,
  SetLlmKeyResponse,
} from './llmKeysApi.types.js';

const BASE_URL = import.meta.env.INTEXURAOS_USER_SERVICE_URL ?? '';

export interface LlmKeysApi {
  getLlmKeys(userId: string): Promise<LlmKeysResponse>;
  setLlmKey(userId: string, request: SetLlmKeyRequest): Promise<SetLlmKeyResponse>;
  deleteLlmKey(userId: string, provider: LlmProvider): Promise<void>;
}

export function createLlmKeysApi(getToken: () => Promise<string>): LlmKeysApi {
  const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const token = await getToken();
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  };

  return {
    async getLlmKeys(userId: string): Promise<LlmKeysResponse> {
      const response = await authFetch(`${BASE_URL}/users/${userId}/settings/llm-keys`);
      if (!response.ok) {
        throw new Error('Failed to fetch LLM keys');
      }
      const data = await response.json();
      return data.data;
    },

    async setLlmKey(userId: string, request: SetLlmKeyRequest): Promise<SetLlmKeyResponse> {
      const response = await authFetch(`${BASE_URL}/users/${userId}/settings/llm-keys`, {
        method: 'PATCH',
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        throw new Error('Failed to set LLM key');
      }
      const data = await response.json();
      return data.data;
    },

    async deleteLlmKey(userId: string, provider: LlmProvider): Promise<void> {
      const response = await authFetch(
        `${BASE_URL}/users/${userId}/settings/llm-keys/${provider}`,
        {
          method: 'DELETE',
        }
      );
      if (!response.ok) {
        throw new Error('Failed to delete LLM key');
      }
    },
  };
}
```

### Step 3: Create hook for API keys

`apps/web/src/hooks/useLlmKeys.ts`:

```typescript
import { useState, useCallback, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { createLlmKeysApi, type LlmKeysApi } from '../services/llmKeysApi.js';
import type { LlmProvider, LlmKeysResponse } from '../services/llmKeysApi.types.js';

export function useLlmKeys(): {
  keys: LlmKeysResponse | null;
  loading: boolean;
  error: string | null;
  setKey: (provider: LlmProvider, apiKey: string) => Promise<void>;
  deleteKey: (provider: LlmProvider) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const { user, getAccessTokenSilently } = useAuth0();
  const [keys, setKeys] = useState<LlmKeysResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [api, setApi] = useState<LlmKeysApi | null>(null);

  useEffect(() => {
    setApi(createLlmKeysApi(getAccessTokenSilently));
  }, [getAccessTokenSilently]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!api || !user?.sub) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getLlmKeys(user.sub);
      setKeys(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load keys');
    } finally {
      setLoading(false);
    }
  }, [api, user?.sub]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setKey = useCallback(
    async (provider: LlmProvider, apiKey: string): Promise<void> => {
      if (!api || !user?.sub) return;
      await api.setLlmKey(user.sub, { provider, apiKey });
      await refresh();
    },
    [api, user?.sub, refresh]
  );

  const deleteKey = useCallback(
    async (provider: LlmProvider): Promise<void> => {
      if (!api || !user?.sub) return;
      await api.deleteLlmKey(user.sub, provider);
      await refresh();
    },
    [api, user?.sub, refresh]
  );

  return { keys, loading, error, setKey, deleteKey, refresh };
}
```

---

## Step Checklist

- [ ] Create `llmKeysApi.types.ts` with types
- [ ] Create `llmKeysApi.ts` with service functions
- [ ] Create `useLlmKeys.ts` hook
- [ ] Run verification commands

---

## Definition of Done

1. Types defined for LLM keys API
2. Service client implements all endpoints
3. Hook provides state management
4. `npm run typecheck` passes

---

## Verification Commands

```bash
npm run typecheck
npm run lint
```

---

## Rollback Plan

If verification fails:

1. Remove created files

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
