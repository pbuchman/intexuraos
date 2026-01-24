# Task 1-1: Implement Linear Connection Repository

## Tier

1 (Independent Deliverables)

## Context

Domain models are defined. Now implement the Firestore repository for storing Linear connection configuration (API key and team selection).

## Problem Statement

Need to implement the `LinearConnectionRepository` interface to store and retrieve user's Linear API key and team configuration in Firestore.

## Scope

### In Scope

- Implement `linearConnectionRepository.ts` in infra/firestore
- Store: userId, apiKey (encrypted), teamId, teamName, connected, timestamps
- All repository methods from ports.ts

### Out of Scope

- API key encryption (use same pattern as notion-service - store plain for now, can add encryption later)
- API validation (done in routes layer)

## Required Approach

1. **Study** `apps/notion-service/src/infra/firestore/notionConnectionRepository.ts`
2. **Implement** all methods from `LinearConnectionRepository` interface
3. **Use** `getFirestore()` from `@intexuraos/infra-firestore`
4. **Follow** error handling patterns with Result type
5. **Write tests** using fake repository pattern

## Step Checklist

- [ ] Create `apps/linear-agent/src/infra/firestore/linearConnectionRepository.ts`
- [ ] Implement `saveLinearConnection` function
- [ ] Implement `getLinearConnection` function
- [ ] Implement `getLinearApiKey` function
- [ ] Implement `getFullLinearConnection` function
- [ ] Implement `isLinearConnected` function
- [ ] Implement `disconnectLinear` function
- [ ] Create `apps/linear-agent/src/__tests__/fakes.ts` with FakeLinearConnectionRepository
- [ ] Create `apps/linear-agent/src/__tests__/infra/linearConnectionRepository.test.ts`
- [ ] Ensure tests pass with coverage

## Definition of Done

- All repository methods implemented
- Tests cover all methods
- Tests pass
- TypeScript compiles

## Verification Commands

```bash
cd apps/linear-agent
pnpm run typecheck
pnpm vitest run src/__tests__/infra/linearConnectionRepository.test.ts
cd ../..
```

## Rollback Plan

```bash
rm -rf apps/linear-agent/src/infra/firestore/
rm -rf apps/linear-agent/src/__tests__/
```

## Reference Files

- `apps/notion-service/src/infra/firestore/notionConnectionRepository.ts`
- `apps/calendar-agent/src/__tests__/fakes.ts`

## infra/firestore/linearConnectionRepository.ts

```typescript
/**
 * Firestore repository for Linear connection configuration.
 * Owned by linear-agent - manages Linear API key and team selection.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type { LinearConnection, LinearConnectionPublic, LinearError } from '../../domain/index.js';

interface LinearConnectionDoc {
  userId: string;
  apiKey: string;
  teamId: string;
  teamName: string;
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

const COLLECTION_NAME = 'linear_connections';

export async function saveLinearConnection(
  userId: string,
  apiKey: string,
  teamId: string,
  teamName: string
): Promise<Result<LinearConnectionPublic, LinearError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    const now = new Date().toISOString();

    const existing = await docRef.get();
    const existingData = existing.data() as LinearConnectionDoc | undefined;

    const doc: LinearConnectionDoc = {
      userId,
      apiKey,
      teamId,
      teamName,
      connected: true,
      createdAt: existingData?.createdAt ?? now,
      updatedAt: now,
    };

    await docRef.set(doc);

    return ok({
      connected: doc.connected,
      teamId: doc.teamId,
      teamName: doc.teamName,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to save connection: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function getLinearConnection(
  userId: string
): Promise<Result<LinearConnectionPublic | null, LinearError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
    if (!doc.exists) return ok(null);

    const data = doc.data() as LinearConnectionDoc;
    return ok({
      connected: data.connected,
      teamId: data.connected ? data.teamId : null,
      teamName: data.connected ? data.teamName : null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to get connection: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function getLinearApiKey(userId: string): Promise<Result<string | null, LinearError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
    if (!doc.exists) return ok(null);

    const data = doc.data() as LinearConnectionDoc;
    if (!data.connected) return ok(null);
    return ok(data.apiKey);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to get API key: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function getFullLinearConnection(
  userId: string
): Promise<Result<LinearConnection | null, LinearError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
    if (!doc.exists) return ok(null);

    const data = doc.data() as LinearConnectionDoc;
    if (!data.connected) return ok(null);

    return ok({
      userId: data.userId,
      apiKey: data.apiKey,
      teamId: data.teamId,
      teamName: data.teamName,
      connected: data.connected,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to get full connection: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function isLinearConnected(userId: string): Promise<Result<boolean, LinearError>> {
  try {
    const db = getFirestore();
    const doc = await db.collection(COLLECTION_NAME).doc(userId).get();
    if (!doc.exists) return ok(false);
    return ok((doc.data() as LinearConnectionDoc).connected);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to check connection: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function disconnectLinear(
  userId: string
): Promise<Result<LinearConnectionPublic, LinearError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    const now = new Date().toISOString();

    const doc = await docRef.get();
    const existingData = doc.data() as LinearConnectionDoc | undefined;

    await docRef.update({ connected: false, updatedAt: now });

    return ok({
      connected: false,
      teamId: null,
      teamName: null,
      createdAt: existingData?.createdAt ?? now,
      updatedAt: now,
    });
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to disconnect: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/** Factory for creating repository with interface */
export function createLinearConnectionRepository() {
  return {
    save: saveLinearConnection,
    getConnection: getLinearConnection,
    getApiKey: getLinearApiKey,
    getFullConnection: getFullLinearConnection,
    isConnected: isLinearConnected,
    disconnect: disconnectLinear,
  };
}
```

## **tests**/fakes.ts (partial - add LinearConnectionRepository fake)

```typescript
/**
 * Test fakes for linear-agent.
 */

import { ok, err, type Result } from '@intexuraos/common-core';
import type {
  LinearConnectionRepository,
  LinearConnection,
  LinearConnectionPublic,
  LinearError,
} from '../domain/index.js';

export class FakeLinearConnectionRepository implements LinearConnectionRepository {
  private connections = new Map<string, LinearConnection>();

  async save(
    userId: string,
    apiKey: string,
    teamId: string,
    teamName: string
  ): Promise<Result<LinearConnectionPublic, LinearError>> {
    const now = new Date().toISOString();
    const existing = this.connections.get(userId);

    const connection: LinearConnection = {
      userId,
      apiKey,
      teamId,
      teamName,
      connected: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.connections.set(userId, connection);

    return ok({
      connected: true,
      teamId,
      teamName,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    });
  }

  async getConnection(userId: string): Promise<Result<LinearConnectionPublic | null, LinearError>> {
    const conn = this.connections.get(userId);
    if (!conn) return ok(null);

    return ok({
      connected: conn.connected,
      teamId: conn.connected ? conn.teamId : null,
      teamName: conn.connected ? conn.teamName : null,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    });
  }

  async getApiKey(userId: string): Promise<Result<string | null, LinearError>> {
    const conn = this.connections.get(userId);
    if (!conn || !conn.connected) return ok(null);
    return ok(conn.apiKey);
  }

  async getFullConnection(userId: string): Promise<Result<LinearConnection | null, LinearError>> {
    const conn = this.connections.get(userId);
    if (!conn || !conn.connected) return ok(null);
    return ok(conn);
  }

  async isConnected(userId: string): Promise<Result<boolean, LinearError>> {
    const conn = this.connections.get(userId);
    return ok(conn?.connected ?? false);
  }

  async disconnect(userId: string): Promise<Result<LinearConnectionPublic, LinearError>> {
    const conn = this.connections.get(userId);
    const now = new Date().toISOString();

    if (conn) {
      conn.connected = false;
      conn.updatedAt = now;
    }

    return ok({
      connected: false,
      teamId: null,
      teamName: null,
      createdAt: conn?.createdAt ?? now,
      updatedAt: now,
    });
  }

  // Test helpers
  reset(): void {
    this.connections.clear();
  }

  seedConnection(conn: LinearConnection): void {
    this.connections.set(conn.userId, conn);
  }
}
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
