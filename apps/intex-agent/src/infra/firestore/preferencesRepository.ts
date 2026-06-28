import type { Firestore } from '@intexuraos/infra-firestore';
import type {
  PreferencesRepository,
} from '../../domain/ports/preferencesRepository.js';
import type {
  IntexAgentExternalSavePreferences,
  IntexAgentPreferences,
  IntexAgentPreferencesUpdate,
} from '../../domain/preferences/types.js';

export const INTEX_AGENT_USER_PREFERENCES_COLLECTION = 'intex_agent_user_preferences';

type PreferencesDocument = Omit<IntexAgentPreferences, 'userId'>;

export interface FirestorePreferencesRepositoryDeps {
  firestore: Firestore;
}

export class FirestorePreferencesRepository implements PreferencesRepository {
  private readonly firestore: Firestore;

  constructor(deps: FirestorePreferencesRepositoryDeps) {
    this.firestore = deps.firestore;
  }

  async getPreferences(userId: string): Promise<IntexAgentPreferences | null> {
    const doc = await this.firestore
      .collection(INTEX_AGENT_USER_PREFERENCES_COLLECTION)
      .doc(userId)
      .get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data() as PreferencesDocument;
    return {
      userId,
      instructions: data.instructions,
      ...(isExternalSavePreferences(data.externalSave)
        ? { externalSave: data.externalSave }
        : {}),
      updatedAt: data.updatedAt,
    };
  }

  async savePreferences(
    userId: string,
    update: IntexAgentPreferencesUpdate
  ): Promise<IntexAgentPreferences> {
    const updatedAt = new Date().toISOString();
    const doc: PreferencesDocument = {
      instructions: update.instructions,
      ...(update.externalSave !== undefined ? { externalSave: update.externalSave } : {}),
      updatedAt,
    };

    await this.firestore
      .collection(INTEX_AGENT_USER_PREFERENCES_COLLECTION)
      .doc(userId)
      .set(doc);

    return { userId, ...doc };
  }

  async deletePreferences(userId: string): Promise<void> {
    await this.firestore
      .collection(INTEX_AGENT_USER_PREFERENCES_COLLECTION)
      .doc(userId)
      .delete();
  }
}

function isExternalSavePreferences(value: unknown): value is IntexAgentExternalSavePreferences {
  if (value === undefined) {
    return false;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record['enabled'] === 'boolean' &&
    typeof record['endpointUrl'] === 'string' &&
    typeof record['cfAccessClientId'] === 'string' &&
    typeof record['cfAccessClientSecret'] === 'string' &&
    typeof record['source'] === 'string'
  );
}
