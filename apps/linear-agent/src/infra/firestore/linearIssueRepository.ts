/**
 * Firestore repository for locally synced Linear issues.
 * Owned by linear-agent - stores issues synced via webhooks and full-sync.
 *
 * Document keys use composite format: `${userId}_${issueId}` to prevent
 * cross-user overwrites when multiple users are connected to the same Linear team.
 *
 * DEPLOYMENT NOTE (INT-623): After deploying, trigger fullSyncAllUsers to repopulate
 * with correctly-keyed documents. Old orphaned documents (keyed by issueId only)
 * can be cleaned up separately — they are harmless but will be returned by field
 * queries until removed.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  SyncedLinearIssue,
  LinearLabel,
  LinearIssueRepository,
  LinearError,
  IssueStateCategory,
  LinearPriority,
} from '../../domain/index.js';

interface SyncedLinearIssueDoc {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: string;
  stateType: IssueStateCategory;
  priority: LinearPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  labels: LinearLabel[];
  url: string;
  userId: string;
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
  syncedAt: string;
  teamId?: string;
}

const COLLECTION_NAME = 'linear_issues';

/** Build composite document key to prevent cross-user overwrites */
function compositeKey(userId: string, issueId: string): string {
  return `${userId}_${issueId}`;
}

export async function saveLinearIssue(
  issue: SyncedLinearIssue
): Promise<Result<SyncedLinearIssue, LinearError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(compositeKey(issue.userId, issue.id));

    const doc: SyncedLinearIssueDoc = {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      state: issue.state,
      stateType: issue.stateType,
      priority: issue.priority,
      assigneeId: issue.assigneeId,
      assigneeName: issue.assigneeName,
      labels: issue.labels,
      url: issue.url,
      userId: issue.userId,
      parentId: issue.parentId,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      syncedAt: issue.syncedAt,
      teamId: issue.teamId,
    };

    await docRef.set(doc);

    return ok(issue);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to save issue: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/**
 * Find issue by Linear UUID using a field query (not doc key lookup).
 * Works without userId — used by webhook comment handler which only has the Linear issue ID.
 *
 * NOTE: In multi-user scenarios where two users have the same Linear issue synced,
 * this returns whichever document Firestore returns first. This is a known
 * limitation for webhook routing (separate issue from INT-623).
 */
export async function findLinearIssueById(
  id: string
): Promise<Result<SyncedLinearIssue | null, LinearError>> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('id', '==', id)
      .limit(1)
      .get();

    if (snapshot.empty) return ok(null);

    /* v8 ignore start -- test-infra: cannot reach snapshot doc branches; FakeLinearIssueRepository returns canned results without Firestore queries @preserve */
    const data = snapshot.docs[0]?.data() as SyncedLinearIssueDoc | undefined;
    if (data === undefined) return ok(null);
    return ok(docToIssue(data));
    /* v8 ignore stop @preserve */
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to find issue: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/**
 * Find issue by identifier (e.g., INT-123).
 * When userId is provided, scopes the query to that user to prevent cross-user leaks.
 */
export async function findLinearIssueByIdentifier(
  identifier: string,
  userId?: string
): Promise<Result<SyncedLinearIssue | null, LinearError>> {
  try {
    const db = getFirestore();
    let query = db
      .collection(COLLECTION_NAME)
      .where('identifier', '==', identifier);

    if (userId !== undefined) {
      query = query.where('userId', '==', userId);
    }

    const snapshot = await query.limit(1).get();

    if (snapshot.empty) return ok(null);

    /* v8 ignore start -- test-infra: cannot reach snapshot doc branches; FakeLinearIssueRepository returns canned results without Firestore queries @preserve */
    const data = snapshot.docs[0]?.data() as SyncedLinearIssueDoc | undefined;
    if (data === undefined) return ok(null);
    return ok(docToIssue(data));
    /* v8 ignore stop @preserve */
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to find issue by identifier: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

const FIRESTORE_IN_LIMIT = 30;

/**
 * Find multiple issues by identifiers, scoped to a user.
 * Chunks identifiers into groups of 30 (Firestore `in` operator limit).
 */
export async function findLinearIssuesByIdentifiers(
  identifiers: string[],
  userId: string
): Promise<Result<SyncedLinearIssue[], LinearError>> {
  if (identifiers.length === 0) return ok([]);

  try {
    const db = getFirestore();
    const allIssues: SyncedLinearIssue[] = [];

    const chunks: string[][] = [];
    for (let i = 0; i < identifiers.length; i += FIRESTORE_IN_LIMIT) {
      chunks.push(identifiers.slice(i, i + FIRESTORE_IN_LIMIT));
    }

    const snapshots = await Promise.all(
      chunks.map((chunk) =>
        db.collection(COLLECTION_NAME)
          .where('identifier', 'in', chunk)
          .where('userId', '==', userId)
          .get()
      )
    );

    for (const snapshot of snapshots) {
      for (const doc of snapshot.docs) {
        allIssues.push(docToIssue(doc.data() as SyncedLinearIssueDoc));
      }
    }

    return ok(allIssues);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to find issues by identifiers: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function listLinearIssuesByUserId(
  userId: string
): Promise<Result<SyncedLinearIssue[], LinearError>> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('userId', '==', userId)
      .get();

    const issues = snapshot.docs.map((doc) => docToIssue(doc.data() as SyncedLinearIssueDoc));
    return ok(issues);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to list issues: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/**
 * Delete issue by Linear UUID, scoped to user via composite key.
 */
export async function deleteLinearIssueById(id: string, userId: string): Promise<Result<void, LinearError>> {
  try {
    const db = getFirestore();
    await db.collection(COLLECTION_NAME).doc(compositeKey(userId, id)).delete();
    return ok(undefined);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to delete issue: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/**
 * Find all userIds who have a specific issue synced (for webhook comment fan-out).
 */
export async function findUserIdsByIssueId(
  issueId: string
): Promise<Result<string[], LinearError>> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('id', '==', issueId)
      .get();

    /* v8 ignore start -- test-infra: cannot reach snapshot branches; FakeLinearIssueRepository returns canned results without Firestore queries @preserve */
    if (snapshot.empty) return ok([]);
    const userIds = snapshot.docs.map((doc) => (doc.data() as SyncedLinearIssueDoc).userId);
    return ok(userIds);
    /* v8 ignore stop @preserve */
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to find users by issue ID: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

function docToIssue(data: SyncedLinearIssueDoc): SyncedLinearIssue {
  return {
    id: data.id,
    identifier: data.identifier,
    title: data.title,
    description: data.description,
    state: data.state,
    stateType: data.stateType,
    priority: data.priority,
    assigneeId: data.assigneeId,
    assigneeName: data.assigneeName,
    labels: data.labels,
    url: data.url,
    userId: data.userId,
    parentId: data.parentId ?? null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    syncedAt: data.syncedAt,
    teamId: data.teamId ?? '',
  };
}

/** Factory for creating repository with interface */
export function createLinearIssueRepository(): LinearIssueRepository {
  return {
    save: saveLinearIssue,
    findById: findLinearIssueById,
    findByIdentifier: findLinearIssueByIdentifier,
    findByIdentifiers: findLinearIssuesByIdentifiers,
    listByUserId: listLinearIssuesByUserId,
    deleteById: deleteLinearIssueById,
    findUserIdsByIssueId,
  };
}
