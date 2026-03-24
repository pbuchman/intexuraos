/**
 * Firestore repository for Linear connection configuration.
 * Owned by linear-agent - manages Linear API key and team selection.
 */
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import { getFirestore } from '@intexuraos/infra-firestore';
import type {
  LinearConnection,
  LinearConnectionPublic,
  LinearConnectionRepository,
  LinearError,
} from '../../domain/index.js';

interface LinearConnectionDoc {
  userId: string;
  apiKey: string;
  teamId: string;
  teamName: string;
  webhookSecret: string | null;
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
      webhookSecret: existingData?.webhookSecret ?? null,
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
      webhookSecret: data.webhookSecret,
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
      /* istanbul ignore next -- @preserve Defensive fallback for legacy docs without createdAt field */
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

export async function findUserIdsByTeamId(teamId: string): Promise<Result<string[], LinearError>> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('connected', '==', true)
      .where('teamId', '==', teamId)
      .get();

    /* v8 ignore start -- test-infra: cannot reach non-empty snapshot branch; FakeLinearConnectionRepository returns canned results without Firestore queries @preserve */
    if (snapshot.empty) return ok([]);
    const userIds = snapshot.docs.map((doc) => doc.id);
    return ok(userIds);
    /* v8 ignore stop @preserve */
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to find users by team ID: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function findWebhookSecretByTeamId(
  teamId: string
): Promise<Result<{ userId: string; webhookSecret: string } | null, LinearError>> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('connected', '==', true)
      .where('teamId', '==', teamId)
      .limit(1)
      .get();

    /* v8 ignore start -- test-infra: cannot reach snapshot branches; FakeLinearConnectionRepository returns canned results without Firestore queries @preserve */
    if (snapshot.empty) return ok(null);
    const doc = snapshot.docs[0];
    if (!doc) return ok(null); // Defensive check
    /* v8 ignore stop @preserve */

    const data = doc.data() as LinearConnectionDoc;
    if (data.webhookSecret === null) return ok(null);

    return ok({ userId: doc.id, webhookSecret: data.webhookSecret });
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to find webhook secret by team ID: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function updateWebhookSecret(
  userId: string,
  webhookSecret: string | null
): Promise<Result<void, LinearError>> {
  try {
    const db = getFirestore();
    const docRef = db.collection(COLLECTION_NAME).doc(userId);
    const now = new Date().toISOString();

    await docRef.update({
      webhookSecret,
      updatedAt: now,
    });

    return ok(undefined);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to update webhook secret: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

export async function getAllConnectedUserIds(): Promise<Result<string[], LinearError>> {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('connected', '==', true)
      .get();

    const userIds = snapshot.docs.map((doc) => doc.id);
    return ok(userIds);
  } catch (error) {
    return err({
      code: 'INTERNAL_ERROR',
      message: `Failed to get connected user IDs: ${getErrorMessage(error, 'Unknown Firestore error')}`,
    });
  }
}

/** Factory for creating repository with interface */
export function createLinearConnectionRepository(): LinearConnectionRepository {
  return {
    save: saveLinearConnection,
    getConnection: getLinearConnection,
    getApiKey: getLinearApiKey,
    getFullConnection: getFullLinearConnection,
    isConnected: isLinearConnected,
    disconnect: disconnectLinear,
    findUserIdsByTeamId,
    findWebhookSecretByTeamId,
    updateWebhookSecret,
    getAllConnectedUserIds,
  };
}
