# Task 5-3: Set Up Dependency Injection Container

**Tier:** 5 (Depends on Tier 4 infrastructure)

---

## Context Snapshot

- Infrastructure adapters available (Tier 4)
- Routes use `getServices()` for dependencies
- Need to wire everything in services.ts

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Set up the services container that:

1. Creates and provides all dependencies
2. Handles async processing
3. Supports testing with fake services

---

## Scope

**In scope:**

- Define Services interface
- Implement getServices() and setServices()
- Create initializeServices() for startup
- Wire async research processing

**Non-scope:**

- Fake implementations (done during testing)

---

## Required Approach

### Step 1: Update services.ts

```typescript
import { Firestore } from '@google-cloud/firestore';
import { createEncryptor, type Encryptor } from '@intexuraos/common-core';
import { FirestoreResearchRepository } from './infra/research/index.js';
import { createLlmProviders, createSynthesizer, type DecryptedApiKeys } from './infra/llm/index.js';
import {
  WhatsAppNotificationSender,
  NoopNotificationSender,
  type UserPhoneLookup,
} from './infra/notification/index.js';
import {
  processResearch,
  type ResearchRepository,
  type LlmResearchProvider,
  type LlmSynthesisProvider,
  type NotificationSender,
  type LlmProvider,
} from './domain/research/index.js';

export interface Services {
  researchRepo: ResearchRepository;
  generateId: () => string;
  processResearchAsync: (researchId: string) => Promise<void>;
  encryptor: Encryptor;
}

let container: Services | null = null;

export function getServices(): Services {
  if (container === null) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return container;
}

export function setServices(services: Services): void {
  container = services;
}

export function resetServices(): void {
  container = null;
}

export async function initializeServices(): Promise<void> {
  const firestore = new Firestore();
  const researchRepo = new FirestoreResearchRepository(firestore);

  const encryptionKey = process.env.INTEXURAOS_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('INTEXURAOS_ENCRYPTION_KEY is required');
  }
  const encryptor = createEncryptor(encryptionKey);

  // User API keys lookup (will be fetched per-request)
  const getUserApiKeys = async (userId: string): Promise<DecryptedApiKeys> => {
    // Call user-service to get encrypted keys, then decrypt
    const userServiceUrl = process.env.USER_SERVICE_URL ?? 'http://localhost:8081';
    const response = await fetch(`${userServiceUrl}/internal/users/${userId}/llm-keys`, {
      headers: {
        'X-Internal-Auth': process.env.INTERNAL_AUTH_TOKEN ?? '',
      },
    });

    if (!response.ok) {
      return {};
    }

    const data = (await response.json()) as {
      google?: string;
      openai?: string;
      anthropic?: string;
    };

    return data;
  };

  // WhatsApp notification setup
  const whatsappAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  let notificationSender: NotificationSender;
  if (whatsappAccessToken && whatsappPhoneNumberId) {
    const userPhoneLookup: UserPhoneLookup = {
      getPhoneNumber: async (userId: string) => {
        // Lookup user's WhatsApp phone from user-service
        const userServiceUrl = process.env.USER_SERVICE_URL ?? 'http://localhost:8081';
        const response = await fetch(`${userServiceUrl}/internal/users/${userId}/whatsapp-phone`, {
          headers: {
            'X-Internal-Auth': process.env.INTERNAL_AUTH_TOKEN ?? '',
          },
        });
        if (!response.ok) return null;
        const data = (await response.json()) as { phone?: string };
        return data.phone ?? null;
      },
    };

    notificationSender = new WhatsAppNotificationSender(
      {
        accessToken: whatsappAccessToken,
        phoneNumberId: whatsappPhoneNumberId,
      },
      userPhoneLookup
    );
  } else {
    notificationSender = new NoopNotificationSender();
  }

  // Async research processing function
  const processResearchAsync = async (researchId: string): Promise<void> => {
    try {
      // Get user ID from research
      const research = await researchRepo.findById(researchId);
      if (research.ok === false || research.value === null) {
        return;
      }

      // Get user's API keys
      const apiKeys = await getUserApiKeys(research.value.userId);

      // Create LLM providers with user's keys
      const llmProviders = createLlmProviders(apiKeys);

      // Synthesizer always uses Google (Gemini)
      const googleKey = apiKeys.google;
      if (!googleKey) {
        // Can't synthesize without Google key
        await researchRepo.update(researchId, {
          status: 'failed',
          synthesisError: 'Google API key required for synthesis',
        });
        return;
      }

      const synthesizer = createSynthesizer(googleKey);

      // Process research
      await processResearch(researchId, {
        researchRepo,
        llmProviders,
        synthesizer,
        notificationSender,
      });
    } catch (error) {
      // Log error but don't throw - this is fire-and-forget
      console.error('Error processing research:', error);
    }
  };

  container = {
    researchRepo,
    generateId: () => crypto.randomUUID(),
    processResearchAsync,
    encryptor,
  };
}
```

---

## Step Checklist

- [ ] Define Services interface
- [ ] Implement getServices(), setServices(), resetServices()
- [ ] Implement initializeServices()
- [ ] Wire Firestore repository
- [ ] Wire encryptor
- [ ] Wire processResearchAsync with user API keys lookup
- [ ] Wire notification sender
- [ ] Run verification commands

---

## Definition of Done

1. Services container created and exported
2. All dependencies properly wired
3. Async processing fetches user's API keys
4. Notification sender configured (or NoOp fallback)
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

1. Revert services.ts to scaffold version
