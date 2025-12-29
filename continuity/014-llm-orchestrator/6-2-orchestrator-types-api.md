# Task 6-2: Create LLM Orchestrator Types and API Client

**Tier:** 6 (Depends on backend Tier 5)

---

## Context Snapshot

- Backend research endpoints exist (Tier 5)
- Need frontend types and API client
- Following patterns from other service clients

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Create TypeScript types and API client for the LLM Orchestrator research feature.

---

## Scope

**In scope:**

- Research type definitions
- API client for CRUD operations
- Hook for research management

**Non-scope:**

- UI components (tasks 6-3 to 6-5)

---

## Required Approach

### Step 1: Create types file

`apps/web/src/services/llmOrchestratorApi.types.ts`:

```typescript
export type LlmProvider = 'google' | 'openai' | 'anthropic';
export type ResearchStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface LlmResult {
  provider: LlmProvider;
  model: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: string;
  error?: string;
  sources?: string[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface Research {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  selectedLlms: LlmProvider[];
  status: ResearchStatus;
  llmResults: LlmResult[];
  synthesizedResult?: string;
  synthesisError?: string;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
}

export interface CreateResearchRequest {
  prompt: string;
  selectedLlms: LlmProvider[];
}

export interface ListResearchesResponse {
  items: Research[];
  nextCursor?: string;
}
```

### Step 2: Create API client

`apps/web/src/services/llmOrchestratorApi.ts`:

```typescript
import type {
  Research,
  CreateResearchRequest,
  ListResearchesResponse,
} from './llmOrchestratorApi.types.js';

const BASE_URL = import.meta.env.INTEXURAOS_LLM_ORCHESTRATOR_URL ?? '';

export interface LlmOrchestratorApi {
  createResearch(request: CreateResearchRequest): Promise<Research>;
  listResearches(cursor?: string, limit?: number): Promise<ListResearchesResponse>;
  getResearch(id: string): Promise<Research>;
  deleteResearch(id: string): Promise<void>;
}

export function createLlmOrchestratorApi(getToken: () => Promise<string>): LlmOrchestratorApi {
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
    async createResearch(request: CreateResearchRequest): Promise<Research> {
      const response = await authFetch(`${BASE_URL}/research`, {
        method: 'POST',
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message ?? 'Failed to create research');
      }
      const data = await response.json();
      return data.data;
    },

    async listResearches(cursor?: string, limit = 50): Promise<ListResearchesResponse> {
      const params = new URLSearchParams();
      if (cursor !== undefined) params.set('cursor', cursor);
      params.set('limit', String(limit));

      const response = await authFetch(`${BASE_URL}/research?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to list researches');
      }
      const data = await response.json();
      return data.data;
    },

    async getResearch(id: string): Promise<Research> {
      const response = await authFetch(`${BASE_URL}/research/${id}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message ?? 'Failed to get research');
      }
      const data = await response.json();
      return data.data;
    },

    async deleteResearch(id: string): Promise<void> {
      const response = await authFetch(`${BASE_URL}/research/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete research');
      }
    },
  };
}
```

### Step 3: Create hook

`apps/web/src/hooks/useResearch.ts`:

```typescript
import { useState, useCallback, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import {
  createLlmOrchestratorApi,
  type LlmOrchestratorApi,
} from '../services/llmOrchestratorApi.js';
import type { Research, CreateResearchRequest } from '../services/llmOrchestratorApi.types.js';

export function useResearch(id: string): {
  research: Research | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const { getAccessTokenSilently } = useAuth0();
  const [research, setResearch] = useState<Research | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const api = createLlmOrchestratorApi(getAccessTokenSilently);
    setLoading(true);
    setError(null);
    try {
      const data = await api.getResearch(id);
      setResearch(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load research');
    } finally {
      setLoading(false);
    }
  }, [id, getAccessTokenSilently]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll for updates while processing
  useEffect(() => {
    if (research?.status === 'pending' || research?.status === 'processing') {
      const interval = setInterval(() => {
        void refresh();
      }, 3000);
      return (): void => clearInterval(interval);
    }
    return undefined;
  }, [research?.status, refresh]);

  return { research, loading, error, refresh };
}

export function useResearches(): {
  researches: Research[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  deleteResearch: (id: string) => Promise<void>;
  createResearch: (request: CreateResearchRequest) => Promise<Research>;
} {
  const { getAccessTokenSilently } = useAuth0();
  const [researches, setResearches] = useState<Research[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);

  const getApi = useCallback((): LlmOrchestratorApi => {
    return createLlmOrchestratorApi(getAccessTokenSilently);
  }, [getAccessTokenSilently]);

  const refresh = useCallback(async (): Promise<void> => {
    const api = getApi();
    setLoading(true);
    setError(null);
    try {
      const data = await api.listResearches();
      setResearches(data.items);
      setCursor(data.nextCursor);
      setHasMore(data.nextCursor !== undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load researches');
    } finally {
      setLoading(false);
    }
  }, [getApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || loading) return;
    const api = getApi();
    try {
      const data = await api.listResearches(cursor);
      setResearches((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor);
      setHasMore(data.nextCursor !== undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more');
    }
  }, [cursor, hasMore, loading, getApi]);

  const deleteResearch = useCallback(
    async (id: string): Promise<void> => {
      const api = getApi();
      await api.deleteResearch(id);
      setResearches((prev) => prev.filter((r) => r.id !== id));
    },
    [getApi]
  );

  const createResearch = useCallback(
    async (request: CreateResearchRequest): Promise<Research> => {
      const api = getApi();
      const research = await api.createResearch(request);
      setResearches((prev) => [research, ...prev]);
      return research;
    },
    [getApi]
  );

  return {
    researches,
    loading,
    error,
    hasMore,
    loadMore,
    refresh,
    deleteResearch,
    createResearch,
  };
}
```

---

## Step Checklist

- [ ] Create `llmOrchestratorApi.types.ts`
- [ ] Create `llmOrchestratorApi.ts`
- [ ] Create `useResearch.ts` hook
- [ ] Create `useResearches.ts` hook
- [ ] Run verification commands

---

## Definition of Done

1. All types match backend models
2. API client implements CRUD
3. Hooks provide state management
4. Auto-polling for processing status
5. `npm run typecheck` passes

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
