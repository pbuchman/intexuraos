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
export function createLinearConnectionRepository(): LinearConnectionRepository {
  return {
    save: saveLinearConnection,
    getConnection: getLinearConnection,
    getApiKey: getLinearApiKey,
    getFullConnection: getFullLinearConnection,
    isConnected: isLinearConnected,
    disconnect: disconnectLinear,
  };
}
