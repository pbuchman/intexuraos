import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeWhatsAppWebhookEventRepository } from '../testing/fakeWhatsAppWebhookEventRepository.js';
import { FirestoreWhatsAppWebhookEventRepository } from '../whatsappWebhookEventRepository.js';

// Mock the client module
vi.mock('../client.js', () => ({
  getFirestore: vi.fn(),
}));

// Import after mock setup
import { getFirestore } from '../client.js';

interface MockDocRef {
  set: (data: unknown) => Promise<void>;
}

interface MockCollectionRef {
  doc: (id: string) => MockDocRef;
}

interface MockFirestoreInstance {
  collection: (name: string) => MockCollectionRef;
}

/**
 * Create an in-memory mock Firestore for testing.
 */
function createMockFirestore(): {
  savedDocs: Map<string, unknown>;
  shouldFail: boolean;
  failWith: Error | null;
  instance: MockFirestoreInstance;
} {
  const savedDocs = new Map<string, unknown>();
  const result = {
    savedDocs,
    shouldFail: false,
    failWith: null as Error | null,
    instance: null as unknown as MockFirestoreInstance,
  };

  result.instance = {
    collection: (_name: string): MockCollectionRef => ({
      doc: (id: string): MockDocRef => ({
        set: (data: unknown): Promise<void> => {
          if (result.shouldFail) {
            if (result.failWith !== null) {
              return Promise.reject(result.failWith);
            }
            return Promise.reject(new Error('Mock Firestore error'));
          }
          savedDocs.set(id, data);
          return Promise.resolve();
        },
      }),
    }),
  };

  return result;
}

describe('FakeWhatsAppWebhookEventRepository', () => {
  let repository: FakeWhatsAppWebhookEventRepository;

  beforeEach(() => {
    repository = new FakeWhatsAppWebhookEventRepository();
  });

  it('saves an event and generates an ID', async () => {
    const event = {
      payload: { test: 'data' },
      signatureValid: true,
      receivedAt: new Date().toISOString(),
      phoneNumberId: '123456789',
      status: 'PENDING' as const,
    };

    const result = await repository.saveEvent(event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBeDefined();
      expect(result.value.id.length).toBeGreaterThan(0);
      expect(result.value.payload).toEqual(event.payload);
      expect(result.value.signatureValid).toBe(true);
      expect(result.value.phoneNumberId).toBe('123456789');
    }
  });

  it('retrieves all saved events', async () => {
    const event1 = {
      payload: { msg: 'first' },
      signatureValid: true,
      receivedAt: new Date().toISOString(),
      phoneNumberId: '111',
      status: 'PENDING' as const,
    };
    const event2 = {
      payload: { msg: 'second' },
      signatureValid: false,
      receivedAt: new Date().toISOString(),
      phoneNumberId: '222',
      status: 'PENDING' as const,
    };

    await repository.saveEvent(event1);
    await repository.saveEvent(event2);

    const events = repository.getAll();
    expect(events.length).toBe(2);
  });

  it('retrieves event by ID', async () => {
    const event = {
      payload: { test: 'byId' },
      signatureValid: true,
      receivedAt: new Date().toISOString(),
      phoneNumberId: '333',
      status: 'PENDING' as const,
    };

    const result = await repository.saveEvent(event);

    if (result.ok) {
      const retrieved = repository.getById(result.value.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.payload).toEqual({ test: 'byId' });
    }
  });

  it('returns undefined for non-existent ID', () => {
    const retrieved = repository.getById('non-existent-id');
    expect(retrieved).toBeUndefined();
  });

  it('clears all events', async () => {
    await repository.saveEvent({
      payload: {},
      signatureValid: true,
      receivedAt: new Date().toISOString(),
      phoneNumberId: null,
      status: 'PENDING' as const,
    });

    repository.clear();

    const events = repository.getAll();
    expect(events.length).toBe(0);
  });

  it('handles null phoneNumberId', async () => {
    const event = {
      payload: {},
      signatureValid: true,
      receivedAt: new Date().toISOString(),
      phoneNumberId: null,
      status: 'PENDING' as const,
    };

    const result = await repository.saveEvent(event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.phoneNumberId).toBeNull();
    }
  });
});

describe('FirestoreWhatsAppWebhookEventRepository', () => {
  let repository: FirestoreWhatsAppWebhookEventRepository;
  let mockFirestore: ReturnType<typeof createMockFirestore>;

  beforeEach(() => {
    repository = new FirestoreWhatsAppWebhookEventRepository();
    mockFirestore = createMockFirestore();
    vi.mocked(getFirestore).mockReturnValue(
      mockFirestore.instance as unknown as ReturnType<typeof getFirestore>
    );
  });

  it('saves event to Firestore successfully', async () => {
    const event = {
      payload: { test: 'data' },
      signatureValid: true,
      receivedAt: '2025-01-01T00:00:00.000Z',
      phoneNumberId: '123456789',
      status: 'PENDING' as const,
    };

    const result = await repository.saveEvent(event);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBeDefined();
      expect(result.value.payload).toEqual(event.payload);
      expect(result.value.signatureValid).toBe(true);
      expect(result.value.phoneNumberId).toBe('123456789');
    }

    // Verify document was saved
    expect(mockFirestore.savedDocs.size).toBe(1);
  });

  it('returns error when Firestore throws', async () => {
    mockFirestore.shouldFail = true;
    mockFirestore.failWith = new Error('Firestore unavailable');

    const event = {
      payload: {},
      signatureValid: true,
      receivedAt: '2025-01-01T00:00:00.000Z',
      phoneNumberId: null,
      status: 'PENDING' as const,
    };

    const result = await repository.saveEvent(event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERSISTENCE_ERROR');
      expect(result.error.message).toContain('Failed to save webhook event');
      expect(result.error.message).toContain('Firestore unavailable');
    }
  });

  it('handles non-Error exceptions', async () => {
    // Create a custom mock that throws a non-Error value
    // We use Object.create(null) to create an object that's not an Error instance
    const nonErrorValue = Object.create(null) as unknown;
    vi.mocked(getFirestore).mockReturnValue({
      collection: (): MockCollectionRef => ({
        doc: (): MockDocRef => ({
          set: (): Promise<void> => {
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            return Promise.reject(nonErrorValue);
          },
        }),
      }),
    } as unknown as ReturnType<typeof getFirestore>);

    const event = {
      payload: {},
      signatureValid: true,
      receivedAt: '2025-01-01T00:00:00.000Z',
      phoneNumberId: null,
      status: 'PENDING' as const,
    };

    const result = await repository.saveEvent(event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERSISTENCE_ERROR');
      expect(result.error.message).toContain('Unknown Firestore error');
    }
  });
});
