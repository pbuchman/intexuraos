/**
 * Firestore implementation of ActionFiltersRepository.
 * Stores filter options and saved filters per user.
 */
import { FieldValue, getFirestore } from '@intexuraos/infra-firestore';
import type {
  ActionFilterOptionField,
  ActionFiltersData,
  CreateSavedActionFilterInput,
  SavedActionFilter,
} from '../../domain/models/actionFilters.js';
import type { ActionFiltersRepository } from '../../domain/ports/actionFiltersRepository.js';

const COLLECTION = 'actions_filters';

/**
 * Document structure in Firestore.
 */
interface FiltersDoc {
  options: {
    status: string[];
    type: string[];
  };
  savedFilters: {
    id: string;
    name: string;
    status?: string;
    type?: string;
    createdAt: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Create default empty document structure.
 */
function createEmptyDoc(): FiltersDoc {
  const now = new Date().toISOString();
  return {
    options: { status: [], type: [] },
    savedFilters: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createFirestoreActionFiltersRepository(): ActionFiltersRepository {
  return {
    async getByUserId(userId: string): Promise<ActionFiltersData | null> {
      const db = getFirestore();
      const docSnap = await db.collection(COLLECTION).doc(userId).get();

      if (!docSnap.exists) {
        return null;
      }

      const data = docSnap.data() as Partial<FiltersDoc>;
      return {
        userId,
        options: {
          status: (data.options?.status ?? []) as ActionFiltersData['options']['status'],
          type: (data.options?.type ?? []) as ActionFiltersData['options']['type'],
        },
        savedFilters: (data.savedFilters ?? []) as SavedActionFilter[],
        createdAt: data.createdAt ?? new Date().toISOString(),
        updatedAt: data.updatedAt ?? new Date().toISOString(),
      };
    },

    async addOption(userId: string, field: ActionFilterOptionField, value: string): Promise<void> {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(userId);
      const now = new Date().toISOString();

      await docRef.set(
        {
          options: { [field]: FieldValue.arrayUnion(value) },
          updatedAt: now,
        },
        { merge: true }
      );
    },

    async addOptions(
      userId: string,
      options: Partial<Record<ActionFilterOptionField, string>>
    ): Promise<void> {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(userId);
      const now = new Date().toISOString();

      const updateData: Record<string, unknown> = { updatedAt: now };

      for (const [field, value] of Object.entries(options)) {
        updateData[`options.${field}`] = FieldValue.arrayUnion(value);
      }

      await docRef.set(updateData, { merge: true });
    },

    async addSavedFilter(
      userId: string,
      filter: CreateSavedActionFilterInput
    ): Promise<SavedActionFilter> {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(userId);

      const savedFilter: SavedActionFilter = {
        id: crypto.randomUUID(),
        name: filter.name,
        createdAt: new Date().toISOString(),
      };

      if (filter.status !== undefined) savedFilter.status = filter.status;
      if (filter.type !== undefined) savedFilter.type = filter.type;

      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        const newDoc = createEmptyDoc();
        newDoc.savedFilters.push(savedFilter);
        await docRef.set(newDoc);
      } else {
        await docRef.update({
          savedFilters: FieldValue.arrayUnion(savedFilter),
          updatedAt: new Date().toISOString(),
        });
      }

      return savedFilter;
    },

    async deleteSavedFilter(userId: string, filterId: string): Promise<void> {
      const db = getFirestore();
      const docRef = db.collection(COLLECTION).doc(userId);

      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        throw new Error('Filter data not found for user');
      }

      const data = docSnap.data() as Partial<FiltersDoc>;
      const savedFilters = data.savedFilters ?? [];
      const updatedFilters = savedFilters.filter((f) => f.id !== filterId);

      if (updatedFilters.length === savedFilters.length) {
        throw new Error('Saved filter not found');
      }

      await docRef.update({
        savedFilters: updatedFilters,
        updatedAt: new Date().toISOString(),
      });
    },
  };
}
