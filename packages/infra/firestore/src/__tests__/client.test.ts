/**
 * Tests for Firestore client singleton.
 *
 * These tests verify the client singleton behavior without using Firestore emulator.
 * They use vi.mock to test the singleton pattern.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getFirestore, resetFirestore, setFirestore } from '../client.js';
import type { Firestore } from '@google-cloud/firestore';

describe('Firestore client', () => {
  beforeEach(() => {
    resetFirestore();
  });

  afterEach(() => {
    resetFirestore();
  });

  describe('getFirestore', () => {
    it('creates Firestore instance on first call', (): void => {
      const instance = getFirestore();
      expect(instance).toBeDefined();
      expect(typeof instance.collection).toBe('function');
    });

    it('returns same instance on subsequent calls (singleton)', (): void => {
      const instance1 = getFirestore();
      const instance2 = getFirestore();

      expect(instance1).toBe(instance2);
    });
  });

  describe('resetFirestore', () => {
    it('clears the singleton instance', (): void => {
      const instance1 = getFirestore();
      resetFirestore();
      const instance2 = getFirestore();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('setFirestore', () => {
    it('sets a custom Firestore instance', (): void => {
      const customInstance = { custom: true } as unknown as Firestore;
      setFirestore(customInstance);

      const instance = getFirestore();
      expect(instance).toBe(customInstance);
    });

    it('overrides existing instance', (): void => {
      const initial = getFirestore();

      const customInstance = { custom: true } as unknown as Firestore;
      setFirestore(customInstance);

      const instance = getFirestore();
      expect(instance).not.toBe(initial);
      expect(instance).toBe(customInstance);
    });
  });
});
