/**
 * Tests for FirestoreWhatsAppUserMappingRepository.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FirestoreWhatsAppUserMappingRepository } from '../whatsappUserMappingRepository.js';
import { FakeWhatsAppUserMappingRepository } from '../testing/fakeWhatsAppUserMappingRepository.js';

// Mock the client module
vi.mock('../client.js', () => ({
  getFirestore: vi.fn(),
}));

// Import after mock setup
import { getFirestore } from '../client.js';

interface WhatsAppUserMappingDoc {
  userId: string;
  phoneNumbers: string[];
  inboxNotesDbId: string;
  connected: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Create an in-memory mock Firestore for WhatsApp user mapping tests.
 */
function createMockFirestore(): {
  docs: Map<string, WhatsAppUserMappingDoc>;
  shouldFail: boolean;
  instance: unknown;
} {
  const docs = new Map<string, WhatsAppUserMappingDoc>();
  const result = {
    docs,
    shouldFail: false,
    instance: null as unknown,
  };

  result.instance = {
    collection: () => ({
      doc: (userId: string) => ({
        get: async () => {
          if (result.shouldFail) {
            throw new Error('Firestore error');
          }
          const data = docs.get(userId);
          return {
            exists: data !== undefined,
            data: () => data,
          };
        },
        set: async (data: WhatsAppUserMappingDoc) => {
          if (result.shouldFail) {
            throw new Error('Firestore error');
          }
          docs.set(userId, data);
        },
        update: async (update: Partial<WhatsAppUserMappingDoc>) => {
          if (result.shouldFail) {
            throw new Error('Firestore error');
          }
          const existing = docs.get(userId);
          if (!existing) {
            throw new Error('Document not found');
          }
          docs.set(userId, { ...existing, ...update });
        },
      }),
      where: (field: string, op: string, value: unknown) => {
        let filtered = Array.from(docs.values());

        if (field === 'phoneNumbers' && op === 'array-contains') {
          filtered = filtered.filter((doc) => doc.phoneNumbers.includes(value as string));
        }
        if (field === 'connected' && op === '==') {
          filtered = filtered.filter((doc) => doc.connected === value);
        }

        return {
          where: (field2: string, op2: string, value2: unknown) => {
            if (field2 === 'connected' && op2 === '==') {
              filtered = filtered.filter((doc) => doc.connected === value2);
            }
            return {
              limit: () => ({
                get: async () => {
                  if (result.shouldFail) {
                    throw new Error('Firestore error');
                  }
                  return {
                    empty: filtered.length === 0,
                    docs: filtered.map((doc) => ({
                      data: () => doc,
                    })),
                  };
                },
              }),
              get: async () => {
                if (result.shouldFail) {
                  throw new Error('Firestore error');
                }
                return {
                  empty: filtered.length === 0,
                  docs: filtered.map((doc) => ({
                    data: () => doc,
                  })),
                };
              },
            };
          },
          get: async () => {
            if (result.shouldFail) {
              throw new Error('Firestore error');
            }
            return {
              empty: filtered.length === 0,
              docs: filtered.map((doc) => ({
                data: () => doc,
              })),
            };
          },
        };
      },
    }),
  };

  return result;
}

describe('FirestoreWhatsAppUserMappingRepository', () => {
  let repo: FirestoreWhatsAppUserMappingRepository;
  let mockDb: ReturnType<typeof createMockFirestore>;

  beforeEach(() => {
    mockDb = createMockFirestore();
    vi.mocked(getFirestore).mockReturnValue(mockDb.instance as never);
    repo = new FirestoreWhatsAppUserMappingRepository();
  });

  describe('saveMapping', () => {
    it('creates new mapping successfully', async () => {
      const result = await repo.saveMapping('user-1', ['+1234567890'], 'notion-db-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.phoneNumbers).toEqual(['+1234567890']);
        expect(result.value.inboxNotesDbId).toBe('notion-db-id');
        expect(result.value.connected).toBe(true);
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('updates existing mapping preserving createdAt', async () => {
      const originalCreatedAt = '2024-01-01T00:00:00.000Z';
      mockDb.docs.set('user-1', {
        userId: 'user-1',
        phoneNumbers: ['+9999999999'],
        inboxNotesDbId: 'old-db-id',
        connected: false,
        createdAt: originalCreatedAt,
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await repo.saveMapping('user-1', ['+1234567890'], 'new-db-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.createdAt).toBe(originalCreatedAt);
        expect(result.value.phoneNumbers).toEqual(['+1234567890']);
        expect(result.value.inboxNotesDbId).toBe('new-db-id');
        expect(result.value.connected).toBe(true);
      }
    });

    it('rejects mapping when phone number is already mapped to different user', async () => {
      mockDb.docs.set('user-2', {
        userId: 'user-2',
        phoneNumbers: ['+1234567890'],
        inboxNotesDbId: 'other-db-id',
        connected: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await repo.saveMapping('user-1', ['+1234567890'], 'my-db-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('already mapped');
        expect(result.error.details).toEqual({
          phoneNumber: '+1234567890',
          conflictingUserId: 'user-2',
        });
      }
    });

    it('allows same user to update their own phone numbers', async () => {
      mockDb.docs.set('user-1', {
        userId: 'user-1',
        phoneNumbers: ['+1111111111'],
        inboxNotesDbId: 'db-id',
        connected: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await repo.saveMapping('user-1', ['+1111111111', '+2222222222'], 'db-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.phoneNumbers).toEqual(['+1111111111', '+2222222222']);
      }
    });

    it('returns error when Firestore operation fails', async () => {
      mockDb.shouldFail = true;

      const result = await repo.saveMapping('user-1', ['+1234567890'], 'db-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Firestore error');
      }
    });
  });

  describe('getMapping', () => {
    it('returns mapping when it exists', async () => {
      mockDb.docs.set('user-1', {
        userId: 'user-1',
        phoneNumbers: ['+1234567890'],
        inboxNotesDbId: 'notion-db-id',
        connected: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      const result = await repo.getMapping('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          phoneNumbers: ['+1234567890'],
          inboxNotesDbId: 'notion-db-id',
          connected: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        });
      }
    });

    it('returns null when mapping does not exist', async () => {
      const result = await repo.getMapping('non-existent-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error when Firestore operation fails', async () => {
      mockDb.shouldFail = true;

      const result = await repo.getMapping('user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to get mapping');
      }
    });
  });

  describe('findUserByPhoneNumber', () => {
    it('finds user by phone number', async () => {
      mockDb.docs.set('user-1', {
        userId: 'user-1',
        phoneNumbers: ['+1234567890', '+0987654321'],
        inboxNotesDbId: 'db-id',
        connected: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await repo.findUserByPhoneNumber('+1234567890');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('user-1');
      }
    });

    it('returns null when phone number not found', async () => {
      const result = await repo.findUserByPhoneNumber('+9999999999');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('ignores disconnected mappings', async () => {
      mockDb.docs.set('user-1', {
        userId: 'user-1',
        phoneNumbers: ['+1234567890'],
        inboxNotesDbId: 'db-id',
        connected: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await repo.findUserByPhoneNumber('+1234567890');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns error when Firestore operation fails', async () => {
      mockDb.shouldFail = true;

      const result = await repo.findUserByPhoneNumber('+1234567890');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to find user by phone number');
      }
    });
  });

  describe('disconnectMapping', () => {
    it('disconnects existing mapping', async () => {
      mockDb.docs.set('user-1', {
        userId: 'user-1',
        phoneNumbers: ['+1234567890'],
        inboxNotesDbId: 'db-id',
        connected: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await repo.disconnectMapping('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.connected).toBe(false);
        expect(result.value.phoneNumbers).toEqual(['+1234567890']);
      }

      const stored = mockDb.docs.get('user-1');
      expect(stored?.connected).toBe(false);
    });

    it('returns error when mapping not found', async () => {
      const result = await repo.disconnectMapping('non-existent-user');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain('Mapping not found');
      }
    });

    it('returns error when Firestore operation fails', async () => {
      mockDb.docs.set('user-1', {
        userId: 'user-1',
        phoneNumbers: ['+1234567890'],
        inboxNotesDbId: 'db-id',
        connected: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      mockDb.shouldFail = true;

      const result = await repo.disconnectMapping('user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to disconnect mapping');
      }
    });
  });

  describe('isConnected', () => {
    it('returns true for connected mapping', async () => {
      mockDb.docs.set('user-1', {
        userId: 'user-1',
        phoneNumbers: ['+1234567890'],
        inboxNotesDbId: 'db-id',
        connected: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await repo.isConnected('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns false for disconnected mapping', async () => {
      mockDb.docs.set('user-1', {
        userId: 'user-1',
        phoneNumbers: ['+1234567890'],
        inboxNotesDbId: 'db-id',
        connected: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await repo.isConnected('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns false for non-existent mapping', async () => {
      const result = await repo.isConnected('non-existent-user');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns error when Firestore operation fails', async () => {
      mockDb.shouldFail = true;

      const result = await repo.isConnected('user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PERSISTENCE_ERROR');
        expect(result.error.message).toContain('Failed to check connection');
      }
    });
  });
});

describe('FakeWhatsAppUserMappingRepository', () => {
  it('provides in-memory test implementation', () => {
    const repo = new FakeWhatsAppUserMappingRepository();
    expect(repo).toBeDefined();
  });
});
