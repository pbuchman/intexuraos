# Guest Chat Sessions Design

**Date:** 2026-02-06
**Status:** Draft
**Author:** Claude + User

## Summary

Enable non-logged-in users to use the chat feature with rate limiting and a platform-provided LLM.

## Decisions

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **LLM Model** | GLM-4.7-Flash | Free tier, no API costs |
| **Provider** | Zai (Zhipu AI) | Provides GLM models |
| **Secret Name** | `INTEXURAOS_GUEST_ZAI_API_KEY` | Stored in GCP Secret Manager |
| **Rate Limit** | 100 messages/hour | Generous since model is free |
| **Session Tracking** | In-memory Map | Simple, resets on deploy (acceptable) |
| **Guest Identification** | UUID in localStorage | Sent via `X-Guest-Session` header |
| **RAG Access** | Full documentation search | Same experience as logged-in users |
| **Auth Detection** | Missing `Authorization` header | Triggers guest flow |

## Architecture

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Frontend   │         │  chat-agent  │         │   Zai API    │
│   (web app)  │         │              │         │ (GLM-4.7-FL) │
└──────┬───────┘         └──────┬───────┘         └──────┬───────┘
       │                        │                        │
       │  POST /chat            │                        │
       │  X-Guest-Session: uuid │                        │
       │  (no Auth header)      │                        │
       ├───────────────────────►│                        │
       │                        │                        │
       │                        │  Check in-memory       │
       │                        │  rate limit map        │
       │                        │                        │
       │                        │  Create GLM client     │
       │                        │  with platform key     │
       │                        ├───────────────────────►│
       │                        │                        │
       │                        │◄───────────────────────┤
       │                        │                        │
       │◄───────────────────────┤                        │
       │  Response              │                        │
```

## Implementation Details

### 1. Guest Rate Limiter

**File:** `apps/chat-agent/src/infra/rateLimit/guestRateLimiter.ts`

```typescript
interface GuestUsage {
  count: number;
  windowStart: number; // timestamp
}

const HOUR_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 100;

export interface GuestRateLimiter {
  check(sessionId: string): Result<void, { message: string }>;
  record(sessionId: string): void;
}

export function createGuestRateLimiter(): GuestRateLimiter {
  const usage = new Map<string, GuestUsage>();

  return {
    check(sessionId: string) {
      const now = Date.now();
      const entry = usage.get(sessionId);

      if (!entry || now - entry.windowStart > HOUR_MS) {
        return ok(undefined);
      }

      if (entry.count >= MAX_PER_HOUR) {
        const resetIn = Math.ceil((entry.windowStart + HOUR_MS - now) / 60000);
        return err({ message: `Rate limit exceeded. Try again in ${resetIn} minutes.` });
      }

      return ok(undefined);
    },

    record(sessionId: string) {
      const now = Date.now();
      const entry = usage.get(sessionId);

      if (!entry || now - entry.windowStart > HOUR_MS) {
        usage.set(sessionId, { count: 1, windowStart: now });
      } else {
        entry.count++;
      }
    },
  };
}
```

### 2. Chat Routes Changes

**File:** `apps/chat-agent/src/routes/chatRoutes.ts`

```typescript
// Change from requireAuth() to tryAuth()
const user = await tryAuth(request);

if (user !== null) {
  // AUTHENTICATED USER - existing flow
  const llmClient = await getServices().userServiceClient.getLlmClient(user.userId);
  // ... existing code
} else {
  // GUEST USER - new flow
  const guestSessionId = request.headers['x-guest-session'];

  if (!guestSessionId || typeof guestSessionId !== 'string') {
    return reply.fail('UNAUTHORIZED', 'Guest session ID required');
  }

  // Check rate limit
  const rateLimitResult = getServices().guestRateLimiter.check(guestSessionId);
  if (!rateLimitResult.ok) {
    return reply.fail('RATE_LIMITED', rateLimitResult.error.message);
  }

  // Use platform GLM client
  const llmClient = getServices().guestLlmClient;

  // Record usage after successful response
  getServices().guestRateLimiter.record(guestSessionId);
}
```

### 3. Service Container Changes

**File:** `apps/chat-agent/src/services.ts`

Add to `ServiceContainer`:
```typescript
readonly guestRateLimiter: GuestRateLimiter;
readonly guestLlmClient: LlmGenerateClient;
```

Initialize in `initializeServices()`:
```typescript
const guestZaiApiKey = process.env['INTEXURAOS_GUEST_ZAI_API_KEY'];

container = {
  // ... existing services
  guestRateLimiter: createGuestRateLimiter(),
  guestLlmClient: createGlmClient({
    apiKey: guestZaiApiKey,
    model: LlmModels.Glm47Flash,
    userId: 'guest',
    pricing: pricingContext.getPricing(LlmModels.Glm47Flash),
    logger,
  }),
};
```

### 4. Frontend Changes

**File:** `apps/web/src/services/chatService.ts`

Add guest session ID management:
```typescript
const GUEST_SESSION_KEY = 'intex-guest-session-id';

export function getOrCreateGuestSessionId(): string {
  let sessionId = localStorage.getItem(GUEST_SESSION_KEY);
  if (sessionId === null) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(GUEST_SESSION_KEY, sessionId);
  }
  return sessionId;
}
```

**File:** `apps/web/src/components/Chat/Chat.tsx`

Modify `handleSendMessage`:
```typescript
const handleSendMessage = useCallback(async (content: string): Promise<void> => {
  const { isAuthenticated, getAccessToken } = useAuth();

  let headers: Record<string, string> = {};

  if (isAuthenticated) {
    const token = await getAccessToken();
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    headers['X-Guest-Session'] = getOrCreateGuestSessionId();
  }

  // ... rest of implementation
}, []);
```

## Files to Change

| File | Change |
|------|--------|
| `apps/chat-agent/src/routes/chatRoutes.ts` | Add guest branch with `tryAuth()` |
| `apps/chat-agent/src/services.ts` | Add `guestRateLimiter` and `guestLlmClient` |
| `apps/chat-agent/src/infra/rateLimit/guestRateLimiter.ts` | New file |
| `apps/chat-agent/src/index.ts` | Add `INTEXURAOS_GUEST_ZAI_API_KEY` to required env |
| `apps/web/src/services/chatService.ts` | Add guest session ID handling |
| `apps/web/src/components/Chat/Chat.tsx` | Generate/store session ID, conditional auth |
| `terraform/environments/dev/main.tf` | Add secret for guest API key |
| `ecosystem.config.cjs` | Add env var for local dev |

## Environment Variables

| Variable | Location | Value |
|----------|----------|-------|
| `INTEXURAOS_GUEST_ZAI_API_KEY` | Secret Manager | Zai API key for GLM-4.7-Flash |

## Testing Considerations

1. **Unit tests** for `guestRateLimiter` (check, record, window reset)
2. **Integration tests** for guest chat flow (no auth header)
3. **Rate limit tests** (verify 100/hour limit)
4. **Frontend tests** for session ID generation and persistence

## Security Considerations

- Guest session IDs are UUIDs (hard to guess)
- Rate limiting prevents abuse
- No user data stored for guests (stateless except rate limit counter)
- Platform API key never exposed to frontend

## Future Considerations

- Persistent rate limiting (Firestore) if abuse becomes an issue
- Guest-to-user conversion (link chat history on sign-up)
- Analytics on guest usage patterns
