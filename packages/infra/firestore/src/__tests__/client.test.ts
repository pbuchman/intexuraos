import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock @google-cloud/firestore before importing client
vi.mock('@google-cloud/firestore', () => ({
  Firestore: vi.fn().mockImplementation(() => ({
    collection: vi.fn(),
    doc: vi.fn(),
  })),
}));

import { getFirestore, resetFirestore, setFirestore } from '../client.js';
import { Firestore } from '@google-cloud/firestore';

describe('Firestore client', () => {
  beforeEach(() => {
    resetFirestore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('getFirestore', () => {
    it('creates Firestore instance on first call', () => {
      const instance = getFirestore();
      expect(instance).toBeDefined();
      expect(Firestore).toHaveBeenCalledTimes(1);
    });

    it('returns same instance on subsequent calls (singleton)', () => {
      const instance1 = getFirestore();
      const instance2 = getFirestore();

      expect(instance1).toBe(instance2);
      expect(Firestore).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetFirestore', () => {
    it('clears the singleton instance', () => {
      getFirestore();
      expect(Firestore).toHaveBeenCalledTimes(1);

      resetFirestore();
      getFirestore();

      expect(Firestore).toHaveBeenCalledTimes(2);
    });
  });

  describe('setFirestore', () => {
    it('sets a custom Firestore instance', () => {
      const customInstance = { custom: true } as unknown as Firestore;
      setFirestore(customInstance);

      const instance = getFirestore();
      expect(instance).toBe(customInstance);
      // Should not create a new instance
      expect(Firestore).not.toHaveBeenCalled();
    });

    it('overrides existing instance', () => {
      getFirestore(); // Create default
      expect(Firestore).toHaveBeenCalledTimes(1);

      const customInstance = { custom: true } as unknown as Firestore;
      setFirestore(customInstance);

      const instance = getFirestore();
      expect(instance).toBe(customInstance);
    });
  });
});
