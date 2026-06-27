import type { Firestore } from '@intexuraos/infra-firestore';
import type {
  PreferencesRepository,
} from '../../domain/ports/preferencesRepository.js';
import type { IntexAgentPreferences } from '../../domain/preferences/types.js';

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
      updatedAt: data.updatedAt,
    };
  }

  async savePreferences(
    userId: string,
    update: { instructions: string }
  ): Promise<IntexAgentPreferences> {
    const updatedAt = new Date().toISOString();
    const doc: PreferencesDocument = {
      instructions: update.instructions,
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