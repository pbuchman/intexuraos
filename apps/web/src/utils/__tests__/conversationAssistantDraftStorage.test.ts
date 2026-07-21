/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearConversationAssistantDraft,
  decideConversationAssistantDraftOwnership,
  getConversationAssistantDraftStorageKey,
  loadConversationAssistantDraft,
  saveConversationAssistantDraft,
  type ConversationAssistantDraftIdentity,
  type ConversationAssistantDraftInput,
} from '../conversationAssistantDraftStorage.js';

const NOW_MS = Date.parse('2026-07-21T10:00:00.000Z');

const identity: ConversationAssistantDraftIdentity = {
  origin: 'https://intexuraos.cloud',
  userId: 'user:one',
  sessionId: 'session/one',
};

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length(): number {
      return values.size;
    },
    clear(): void {
      values.clear();
    },
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    key(index: number): string | null {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      values.delete(key);
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
  };
}

let storage: Storage;

beforeEach(() => {
  storage = createMemoryStorage();
});

describe('getConversationAssistantDraftStorageKey', () => {
  it('isolates drafts by origin, user, and session without ambiguous separators', () => {
    const base = {
      origin: 'https://intexuraos.cloud',
      userId: 'user:one',
      sessionId: 'session/one',
    };

    const key = getConversationAssistantDraftStorageKey(base);

    expect(key).not.toBe(
      getConversationAssistantDraftStorageKey({
        ...base,
        origin: 'https://dev.intexuraos.cloud',
      })
    );
    expect(key).not.toBe(
      getConversationAssistantDraftStorageKey({ ...base, userId: 'user' })
    );
    expect(key).not.toBe(
      getConversationAssistantDraftStorageKey({ ...base, sessionId: 'one' })
    );
    expect(key).toContain(encodeURIComponent(base.origin));
    expect(key).toContain(encodeURIComponent(base.userId));
    expect(key).toContain(encodeURIComponent(base.sessionId));
  });
});

describe('Conversation Assistant draft codec', () => {
  it('round-trips only the version 1 allowlist', () => {
    const draft = {
      question: 'How did the attitude change?',
      preparationRequestId: 'prepare-1',
      replacesAttachmentId: 'attachment-old',
      attachmentId: 'attachment-new',
      startedTurnRequestId: 'turn-1',
      warningAcknowledged: true,
      whatsappContent: 'private message',
      preview: { text: 'private preview' },
      confirmationToken: 'secret-token',
      sourceAccountId: 'source-1',
      contextChainSha256: 'private-hash',
      answer: 'private answer',
    } as ConversationAssistantDraftInput & Record<string, unknown>;

    const saved = saveConversationAssistantDraft(storage, identity, draft, {
      nowMs: NOW_MS,
    });
    const key = getConversationAssistantDraftStorageKey(identity);
    const raw = storage.getItem(key);

    expect(saved).toEqual({
      version: 1,
      question: 'How did the attitude change?',
      preparationRequestId: 'prepare-1',
      replacesAttachmentId: 'attachment-old',
      attachmentId: 'attachment-new',
      startedTurnRequestId: 'turn-1',
      warningAcknowledged: true,
      savedAt: '2026-07-21T10:00:00.000Z',
      expiresAt: '2026-07-21T10:30:00.000Z',
    });
    expect(JSON.parse(raw ?? '{}')).toEqual(saved);
    expect(loadConversationAssistantDraft(storage, identity, { nowMs: NOW_MS })).toEqual(
      saved
    );
  });

  it('supports a question-only draft without inventing identifiers', () => {
    const saved = saveConversationAssistantDraft(
      storage,
      identity,
      { question: '', warningAcknowledged: false },
      { nowMs: NOW_MS }
    );

    expect(saved).toEqual({
      version: 1,
      question: '',
      warningAcknowledged: false,
      savedAt: '2026-07-21T10:00:00.000Z',
      expiresAt: '2026-07-21T10:30:00.000Z',
    });
  });

  it.each([
    ['malformed JSON', '{not-json'],
    [
      'an unsupported version',
      JSON.stringify({
        version: 2,
        question: 'question',
        warningAcknowledged: false,
        savedAt: '2026-07-21T10:00:00.000Z',
        expiresAt: '2026-07-21T10:30:00.000Z',
      }),
    ],
    [
      'an unknown persisted field',
      JSON.stringify({
        version: 1,
        question: 'question',
        warningAcknowledged: false,
        savedAt: '2026-07-21T10:00:00.000Z',
        expiresAt: '2026-07-21T10:30:00.000Z',
        preview: 'private preview',
      }),
    ],
    [
      'an invalid identifier',
      JSON.stringify({
        version: 1,
        question: 'question',
        attachmentId: '',
        warningAcknowledged: false,
        savedAt: '2026-07-21T10:00:00.000Z',
        expiresAt: '2026-07-21T10:30:00.000Z',
      }),
    ],
  ])('clears %s instead of restoring it', (_label, raw) => {
    const key = getConversationAssistantDraftStorageKey(identity);
    storage.setItem(key, raw);

    expect(loadConversationAssistantDraft(storage, identity, { nowMs: NOW_MS })).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });
});

describe('Conversation Assistant draft expiry', () => {
  it('renews the rolling expiry to 30 minutes after every save', () => {
    const draft: ConversationAssistantDraftInput = {
      question: 'question',
      warningAcknowledged: false,
    };

    saveConversationAssistantDraft(storage, identity, draft, { nowMs: NOW_MS });
    const renewed = saveConversationAssistantDraft(storage, identity, draft, {
      nowMs: NOW_MS + 10 * 60 * 1000,
    });

    expect(renewed?.savedAt).toBe('2026-07-21T10:10:00.000Z');
    expect(renewed?.expiresAt).toBe('2026-07-21T10:40:00.000Z');
  });

  it('keeps the draft until at least five minutes after attachment expiry', () => {
    const saved = saveConversationAssistantDraft(
      storage,
      identity,
      {
        question: 'question',
        attachmentId: 'attachment-1',
        warningAcknowledged: false,
      },
      {
        nowMs: NOW_MS,
        attachmentExpiresAt: '2026-07-21T10:45:00.000Z',
      }
    );

    expect(saved?.expiresAt).toBe('2026-07-21T10:50:00.000Z');
    expect(storage.getItem(getConversationAssistantDraftStorageKey(identity))).not.toContain(
      'attachmentExpiresAt'
    );
  });

  it('keeps the rolling expiry when it is later than attachment expiry plus grace', () => {
    const saved = saveConversationAssistantDraft(
      storage,
      identity,
      {
        question: 'question',
        attachmentId: 'attachment-1',
        warningAcknowledged: false,
      },
      {
        nowMs: NOW_MS,
        attachmentExpiresAt: '2026-07-21T10:05:00.000Z',
      }
    );

    expect(saved?.expiresAt).toBe('2026-07-21T10:30:00.000Z');
  });

  it('updates attachment metadata without renewing the last-edit TTL', () => {
    const original = saveConversationAssistantDraft(
      storage,
      identity,
      {
        question: 'question',
        attachmentId: 'attachment-1',
        warningAcknowledged: false,
      },
      { nowMs: NOW_MS }
    );
    expect(original).not.toBeNull();
    if (original === null) throw new Error('Expected the original draft to be stored');

    const metadataUpdate = saveConversationAssistantDraft(
      storage,
      identity,
      {
        question: 'question',
        attachmentId: 'attachment-1',
        warningAcknowledged: false,
      },
      {
        nowMs: NOW_MS + 20 * 60 * 1000,
        lastEditedAt: original.savedAt,
        attachmentExpiresAt: '2026-07-21T10:45:00.000Z',
      }
    );

    expect(metadataUpdate?.savedAt).toBe('2026-07-21T10:00:00.000Z');
    expect(metadataUpdate?.expiresAt).toBe('2026-07-21T10:50:00.000Z');
  });

  it('clears a draft when its preserved last-edit timestamp is invalid or already expired', () => {
    const draft: ConversationAssistantDraftInput = {
      question: 'question',
      warningAcknowledged: false,
    };
    saveConversationAssistantDraft(storage, identity, draft, { nowMs: NOW_MS });

    expect(
      saveConversationAssistantDraft(storage, identity, draft, {
        nowMs: NOW_MS + 10 * 60 * 1000,
        lastEditedAt: 'not-a-date',
      })
    ).toBeNull();
    expect(storage.getItem(getConversationAssistantDraftStorageKey(identity))).toBeNull();

    saveConversationAssistantDraft(storage, identity, draft, { nowMs: NOW_MS });
    expect(
      saveConversationAssistantDraft(storage, identity, draft, {
        nowMs: NOW_MS + 31 * 60 * 1000,
        lastEditedAt: '2026-07-21T10:00:00.000Z',
      })
    ).toBeNull();
    expect(storage.getItem(getConversationAssistantDraftStorageKey(identity))).toBeNull();
  });

  it('clears an expired draft at the expiry boundary', () => {
    saveConversationAssistantDraft(
      storage,
      identity,
      { question: 'question', warningAcknowledged: false },
      { nowMs: NOW_MS }
    );

    expect(
      loadConversationAssistantDraft(storage, identity, {
        nowMs: Date.parse('2026-07-21T10:29:59.999Z'),
      })
    ).not.toBeNull();
    expect(
      loadConversationAssistantDraft(storage, identity, {
        nowMs: Date.parse('2026-07-21T10:30:00.000Z'),
      })
    ).toBeNull();
    expect(storage.getItem(getConversationAssistantDraftStorageKey(identity))).toBeNull();
  });

  it('clears instead of saving when the attachment expiry is invalid', () => {
    saveConversationAssistantDraft(
      storage,
      identity,
      { question: 'old question', warningAcknowledged: false },
      { nowMs: NOW_MS }
    );

    const saved = saveConversationAssistantDraft(
      storage,
      identity,
      {
        question: 'new question',
        attachmentId: 'attachment-1',
        warningAcknowledged: false,
      },
      { nowMs: NOW_MS, attachmentExpiresAt: 'not-a-date' }
    );

    expect(saved).toBeNull();
    expect(storage.getItem(getConversationAssistantDraftStorageKey(identity))).toBeNull();
  });

  it('clears an invalid clock value without throwing', () => {
    saveConversationAssistantDraft(
      storage,
      identity,
      { question: 'old question', warningAcknowledged: false },
      { nowMs: NOW_MS }
    );

    expect(() =>
      saveConversationAssistantDraft(
        storage,
        identity,
        { question: 'new question', warningAcknowledged: false },
        { nowMs: Number.MAX_VALUE }
      )
    ).not.toThrow();
    expect(storage.getItem(getConversationAssistantDraftStorageKey(identity))).toBeNull();
  });

  it('clears instead of restoring when the load clock is outside the Date range', () => {
    saveConversationAssistantDraft(
      storage,
      identity,
      { question: 'question', warningAcknowledged: false },
      { nowMs: NOW_MS }
    );

    expect(
      loadConversationAssistantDraft(storage, identity, {
        nowMs: -Number.MAX_VALUE,
      })
    ).toBeNull();
    expect(storage.getItem(getConversationAssistantDraftStorageKey(identity))).toBeNull();
  });
});

describe('Conversation Assistant draft storage boundaries', () => {
  it('clears only the selected origin/user/session key', () => {
    const otherIdentity = { ...identity, sessionId: 'session-two' };
    const draft: ConversationAssistantDraftInput = {
      question: 'question',
      warningAcknowledged: false,
    };
    saveConversationAssistantDraft(storage, identity, draft, { nowMs: NOW_MS });
    saveConversationAssistantDraft(storage, otherIdentity, draft, { nowMs: NOW_MS });

    clearConversationAssistantDraft(storage, identity);

    expect(storage.getItem(getConversationAssistantDraftStorageKey(identity))).toBeNull();
    expect(storage.getItem(getConversationAssistantDraftStorageKey(otherIdentity))).not.toBeNull();
  });

  it('does not throw when session storage is unavailable', () => {
    const unavailableStorage: Storage = {
      get length(): number {
        throw new DOMException('blocked', 'SecurityError');
      },
      clear(): void {
        throw new DOMException('blocked', 'SecurityError');
      },
      getItem(): string | null {
        throw new DOMException('blocked', 'SecurityError');
      },
      key(): string | null {
        throw new DOMException('blocked', 'SecurityError');
      },
      removeItem(): void {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem(): void {
        throw new DOMException('blocked', 'SecurityError');
      },
    };
    const draft: ConversationAssistantDraftInput = {
      question: 'question',
      warningAcknowledged: false,
    };

    expect(saveConversationAssistantDraft(unavailableStorage, identity, draft)).toBeNull();
    expect(loadConversationAssistantDraft(unavailableStorage, identity)).toBeNull();
    expect(() => clearConversationAssistantDraft(unavailableStorage, identity)).not.toThrow();
  });
});

describe('decideConversationAssistantDraftOwnership', () => {
  it('keeps mutable request ids when no different tab owns them', () => {
    expect(
      decideConversationAssistantDraftOwnership({ runtimeOwnerNonce: 'tab-a' })
    ).toBe('reuse_current_request_ids');
    expect(
      decideConversationAssistantDraftOwnership({
        runtimeOwnerNonce: 'tab-a',
        announcedOwnerNonce: 'tab-a',
      })
    ).toBe('reuse_current_request_ids');
  });

  it('requires fresh mutable request ids when another tab owns an unstarted draft', () => {
    expect(
      decideConversationAssistantDraftOwnership({
        runtimeOwnerNonce: 'tab-b',
        announcedOwnerNonce: 'tab-a',
      })
    ).toBe('regenerate_unstarted_request_ids');
  });

  it('recovers an already-started turn instead of regenerating its request id', () => {
    expect(
      decideConversationAssistantDraftOwnership({
        runtimeOwnerNonce: 'tab-b',
        announcedOwnerNonce: 'tab-a',
        startedTurnRequestId: 'turn-1',
      })
    ).toBe('recover_started_turn_request');
  });
});
