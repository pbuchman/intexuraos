# Task 4-0: Implement Firestore Research Repository

**Tier:** 4 (Infrastructure layer — depends on Tier 3 domain)

---

## Context Snapshot

- Domain models and ports defined (Tier 3)
- ResearchRepository port needs Firestore implementation
- Following patterns from existing Firestore repositories in the codebase

**Working according to:** `.github/prompts/continuity.prompt.md`

---

## Problem Statement

Implement the ResearchRepository port using Firestore for persistence. Handle all CRUD operations for Research documents.

---

## Scope

**In scope:**

- Create FirestoreResearchRepository class
- Implement all ResearchRepository methods
- Handle Firestore document mapping
- Support pagination with cursors

**Non-scope:**

- LLM client adapters (task 4-1)
- WhatsApp notification (task 4-2)

---

## Required Approach

### Step 1: Create infra directory

```bash
mkdir -p apps/research-agent-service/src/infra/research
```

### Step 2: Create FirestoreResearchRepository.ts

```typescript
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type {
  Research,
  LlmResult,
  LlmProvider,
  ResearchRepository,
  RepositoryError,
} from '../../domain/research/index.js';

export class FirestoreResearchRepository implements ResearchRepository {
  private readonly collection;

  constructor(firestore: Firestore, collectionName = 'researches') {
    this.collection = firestore.collection(collectionName);
  }

  async save(research: Research): Promise<Result<Research, RepositoryError>> {
    try {
      await this.collection.doc(research.id).set(research);
      return ok(research);
    } catch (error) {
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Failed to save research'),
      });
    }
  }

  async findById(id: string): Promise<Result<Research | null, RepositoryError>> {
    try {
      const doc = await this.collection.doc(id).get();
      if (!doc.exists) {
        return ok(null);
      }
      return ok(doc.data() as Research);
    } catch (error) {
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Failed to find research'),
      });
    }
  }

  async findByUserId(
    userId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<Result<{ items: Research[]; nextCursor?: string }, RepositoryError>> {
    try {
      let query = this.collection
        .where('userId', '==', userId)
        .orderBy('startedAt', 'desc')
        .limit(options?.limit ?? 50);

      if (options?.cursor) {
        const cursorDoc = await this.collection.doc(options.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.get();
      const items = snapshot.docs.map((doc) => doc.data() as Research);
      const lastDoc = snapshot.docs[snapshot.docs.length - 1];
      const nextCursor = lastDoc?.id;

      return ok({ items, nextCursor });
    } catch (error) {
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Failed to list researches'),
      });
    }
  }

  async update(id: string, updates: Partial<Research>): Promise<Result<Research, RepositoryError>> {
    try {
      await this.collection.doc(id).update(updates);
      const updated = await this.findById(id);
      if (updated.ok === false) {
        return updated;
      }
      if (updated.value === null) {
        return err({ code: 'NOT_FOUND', message: 'Research not found' });
      }
      return ok(updated.value);
    } catch (error) {
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Failed to update research'),
      });
    }
  }

  async updateLlmResult(
    researchId: string,
    provider: LlmProvider,
    result: Partial<LlmResult>
  ): Promise<Result<void, RepositoryError>> {
    try {
      const docRef = this.collection.doc(researchId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return err({ code: 'NOT_FOUND', message: 'Research not found' });
      }

      const research = doc.data() as Research;
      const llmResults = research.llmResults.map((r) =>
        r.provider === provider ? { ...r, ...result } : r
      );

      await docRef.update({ llmResults });
      return ok(undefined);
    } catch (error) {
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Failed to update LLM result'),
      });
    }
  }

  async delete(id: string): Promise<Result<void, RepositoryError>> {
    try {
      await this.collection.doc(id).delete();
      return ok(undefined);
    } catch (error) {
      return err({
        code: 'FIRESTORE_ERROR',
        message: getErrorMessage(error, 'Failed to delete research'),
      });
    }
  }
}
```

### Step 3: Create infra/research/index.ts

```typescript
export { FirestoreResearchRepository } from './FirestoreResearchRepository.js';
```

### Step 4: Create infra/index.ts

```typescript
export * from './research/index.js';
```

---

## Step Checklist

- [ ] Create infra/research directory
- [ ] Implement `FirestoreResearchRepository`
- [ ] Implement all ResearchRepository methods
- [ ] Handle pagination with cursors
- [ ] Create index files
- [ ] Run verification commands

---

## Definition of Done

1. FirestoreResearchRepository implements ResearchRepository
2. All CRUD operations working
3. Pagination working with cursors
4. `updateLlmResult` updates specific LLM result
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

1. Remove infra/research directory
2. Remove infra/index.ts
