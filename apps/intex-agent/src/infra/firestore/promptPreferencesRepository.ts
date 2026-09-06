import type { DocumentData, Firestore } from '@intexuraos/infra-firestore';
import type {
  AddPromptPreferenceItemRepositoryInput,
  DeletePromptPreferenceItemRepositoryInput,
  PromptPreferencesRepository,
  UpdatePromptPreferenceItemRepositoryInput,
} from '../../domain/ports/promptPreferencesRepository.js';
import {
  addPromptPreferenceItem,
  assertExpectedPromptPreferenceVersion,
  createPromptPreferenceItemId,
  deletePromptPreferenceItem,
  emptyPromptPreferences,
  promptPreferenceVersionId,
  updatePromptPreferenceItem,
  type IntexAgentPromptPreferenceItem,
  type IntexAgentPromptPreferenceVersion,
  type IntexAgentPromptPreferenceVersionSummary,
  type IntexAgentPromptPreferences,
  type PreferenceUpdatedBy,
  type PromptPreferenceMutationResult,
} from '../../domain/preferences/promptPreferences.js';

type FirestoreDocumentReference = ReturnType<ReturnType<Firestore['collection']>['doc']>;

export const INTEX_AGENT_PROMPT_PREFERENCES_COLLECTION = 'intex_agent_prompt_preferences';
export const INTEX_AGENT_PROMPT_PREFERENCE_VERSIONS_COLLECTION =
  'intex_agent_prompt_preference_versions';

export interface FirestorePromptPreferencesRepositoryDeps {
  firestore: Firestore;
  now?: () => string;
  createItemId?: () => string;
}

export class FirestorePromptPreferencesRepository implements PromptPreferencesRepository {
  private readonly firestore: Firestore;
  private readonly now: () => string;
  private readonly createItemId: () => string;

  constructor(deps: FirestorePromptPreferencesRepositoryDeps) {
    this.firestore = deps.firestore;
    this.now = deps.now ?? ((): string => new Date().toISOString());
    this.createItemId = deps.createItemId ?? createPromptPreferenceItemId;
  }

  async getCurrent(userId: string): Promise<IntexAgentPromptPreferences> {
    const snapshot = await this.currentDoc(userId).get();
    if (!snapshot.exists) {
      return emptyPromptPreferences(userId);
    }
    return toPromptPreferences(userId, snapshot.data());
  }

  async listVersions(userId: string): Promise<IntexAgentPromptPreferenceVersionSummary[]> {
    const snapshot = await this.firestore
      .collection(INTEX_AGENT_PROMPT_PREFERENCE_VERSIONS_COLLECTION)
      .where('userId', '==', userId)
      .get();

    return snapshot.docs
      .map((doc) => toPromptPreferenceVersion(doc.id, doc.data()))
      .sort((a, b) => b.version - a.version)
      .map(toVersionSummary);
  }

  async getVersion(
    userId: string,
    version: number
  ): Promise<IntexAgentPromptPreferenceVersion | null> {
    const snapshot = await this.versionDoc(userId, version).get();
    if (!snapshot.exists) {
      return null;
    }
    const versionDoc = toPromptPreferenceVersion(snapshot.id, snapshot.data());
    return versionDoc.userId === userId ? versionDoc : null;
  }

  async addItem(
    input: AddPromptPreferenceItemRepositoryInput
  ): Promise<IntexAgentPromptPreferences> {
    return await this.mutate(input.userId, input.expectedVersion, (current, now) =>
      addPromptPreferenceItem(current, {
        id: this.createItemId(),
        text: input.text,
        now,
        updatedBy: input.updatedBy,
      })
    );
  }

  async updateItem(
    input: UpdatePromptPreferenceItemRepositoryInput
  ): Promise<IntexAgentPromptPreferences> {
    return await this.mutate(input.userId, input.expectedVersion, (current, now) =>
      updatePromptPreferenceItem(current, {
        itemId: input.itemId,
        text: input.text,
        now,
        updatedBy: input.updatedBy,
      })
    );
  }

  async deleteItem(
    input: DeletePromptPreferenceItemRepositoryInput
  ): Promise<IntexAgentPromptPreferences> {
    return await this.mutate(input.userId, input.expectedVersion, (current, now) =>
      deletePromptPreferenceItem(current, {
        itemId: input.itemId,
        now,
        updatedBy: input.updatedBy,
      })
    );
  }

  private async mutate(
    userId: string,
    expectedVersion: number,
    buildMutation: (
      current: IntexAgentPromptPreferences,
      now: string
    ) => PromptPreferenceMutationResult
  ): Promise<IntexAgentPromptPreferences> {
    const outcome = await this.firestore.runTransaction(async (transaction) => {
      try {
        const currentRef = this.currentDoc(userId);
        const currentSnapshot = await transaction.get(currentRef);
        const current = currentSnapshot.exists
          ? toPromptPreferences(userId, currentSnapshot.data())
          : emptyPromptPreferences(userId);

        assertExpectedPromptPreferenceVersion(current, expectedVersion);

        const mutation = buildMutation(current, this.now());
        const versionRef = this.versionDoc(userId, mutation.version.version);
        const versionSnapshot = await transaction.get(versionRef);
        if (versionSnapshot.exists) {
          throw new Error(`Preference version ${mutation.version.id} already exists`);
        }

        transaction.set(currentRef, mutation.current);
        transaction.set(versionRef, mutation.version);
        return { ok: true as const, value: mutation.current };
      } catch (error) {
        return { ok: false as const, error };
      }
    });
    if (!outcome.ok) {
      throw outcome.error;
    }
    return outcome.value;
  }

  private currentDoc(userId: string): FirestoreDocumentReference {
    return this.firestore.collection(INTEX_AGENT_PROMPT_PREFERENCES_COLLECTION).doc(userId);
  }

  private versionDoc(userId: string, version: number): FirestoreDocumentReference {
    return this.firestore
      .collection(INTEX_AGENT_PROMPT_PREFERENCE_VERSIONS_COLLECTION)
      .doc(promptPreferenceVersionId(userId, version));
  }
}

function toPromptPreferences(
  userId: string,
  data: DocumentData | undefined
): IntexAgentPromptPreferences {
  const record = asRecord(data);
  const currentVersion = numberOr(record['currentVersion'], 0);
  const items = arrayOr(record['items']).map(toPromptPreferenceItem).filter(isPresent);
  return {
    userId,
    schemaVersion: 1,
    currentVersion,
    items,
    renderedPromptBlock: stringOr(record['renderedPromptBlock'], ''),
    createdAt: nullableString(record['createdAt']),
    updatedAt: nullableString(record['updatedAt']),
    updatedBy: toPreferenceUpdatedBy(record['updatedBy']),
  };
}

function toPromptPreferenceVersion(
  id: string,
  data: DocumentData | undefined
): IntexAgentPromptPreferenceVersion {
  const record = asRecord(data);
  const createdBy = toPreferenceUpdatedBy(record['createdBy']);
  if (createdBy === null) {
    throw new Error(`Prompt preference version ${id} is missing createdBy`);
  }
  return {
    id: stringOr(record['id'], id),
    userId: stringOr(record['userId'], ''),
    version: numberOr(record['version'], 0),
    items: arrayOr(record['items']).map(toPromptPreferenceItem).filter(isPresent),
    renderedPromptBlock: stringOr(record['renderedPromptBlock'], ''),
    changeType: toChangeType(record['changeType']),
    ...(typeof record['changedItemId'] === 'string'
      ? { changedItemId: record['changedItemId'] }
      : {}),
    ...(typeof record['previousText'] === 'string'
      ? { previousText: record['previousText'] }
      : {}),
    ...(typeof record['nextText'] === 'string' ? { nextText: record['nextText'] } : {}),
    itemCount: numberOr(record['itemCount'], arrayOr(record['items']).length),
    createdAt: stringOr(record['createdAt'], ''),
    createdBy,
  };
}

function toVersionSummary(
  version: IntexAgentPromptPreferenceVersion
): IntexAgentPromptPreferenceVersionSummary {
  return {
    version: version.version,
    changeType: version.changeType,
    ...(version.changedItemId !== undefined ? { changedItemId: version.changedItemId } : {}),
    ...(version.previousText !== undefined ? { previousText: version.previousText } : {}),
    ...(version.nextText !== undefined ? { nextText: version.nextText } : {}),
    itemCount: version.itemCount,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
  };
}

function toPromptPreferenceItem(value: unknown): IntexAgentPromptPreferenceItem | null {
  const record = asRecord(value);
  const id = record['id'];
  const text = record['text'];
  const createdAt = record['createdAt'];
  const updatedAt = record['updatedAt'];
  if (
    typeof id !== 'string' ||
    typeof text !== 'string' ||
    typeof createdAt !== 'string' ||
    typeof updatedAt !== 'string'
  ) {
    return null;
  }
  return { id, text, createdAt, updatedAt };
}

function toPreferenceUpdatedBy(value: unknown): PreferenceUpdatedBy | null {
  const record = asRecord(value);
  if (record['actor'] === 'web_ui' && typeof record['userId'] === 'string') {
    return { actor: 'web_ui', userId: record['userId'] };
  }
  if (
    record['actor'] === 'agent_tool' &&
    typeof record['userId'] === 'string' &&
    typeof record['sessionId'] === 'string'
  ) {
    return {
      actor: 'agent_tool',
      userId: record['userId'],
      sessionId: record['sessionId'],
      ...(typeof record['messageId'] === 'string' ? { messageId: record['messageId'] } : {}),
    };
  }
  return null;
}

function toChangeType(value: unknown): IntexAgentPromptPreferenceVersion['changeType'] {
  return value === 'update' || value === 'delete' ? value : 'add';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function arrayOr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
