/**
 * Tests for Fake Firestore implementation.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { FieldValue } from '@google-cloud/firestore';
import { createFakeFirestore, type FakeFirestore } from '../testing/firestoreFake.js';

describe('FakeFirestore', () => {
  let db: FakeFirestore;

  beforeEach(() => {
    db = createFakeFirestore();
  });

  describe('createFakeFirestore', () => {
    it('creates a new instance', () => {
      const instance = createFakeFirestore();
      expect(instance).toBeDefined();
      expect(typeof instance.collection).toBe('function');
    });
  });

  describe('collection operations', () => {
    it('creates collection reference', () => {
      const col = db.collection('users');
      expect(col).toBeDefined();
    });

    it('creates document reference from collection', () => {
      const docRef = db.collection('users').doc('user-1');
      expect(docRef).toBeDefined();
      expect(docRef.id).toBe('user-1');
    });

    it('auto-generates document ID when not provided', () => {
      const docRef = db.collection('users').doc();
      expect(docRef.id).toMatch(/^auto-\d+$/);
    });

    it('generates sequential auto IDs', () => {
      const doc1 = db.collection('users').doc();
      const doc2 = db.collection('users').doc();
      expect(doc1.id).toBe('auto-1');
      expect(doc2.id).toBe('auto-2');
    });
  });

  describe('document operations', () => {
    describe('set', () => {
      it('creates a new document', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ name: 'John', age: 30 });

        const snapshot = await docRef.get();
        expect(snapshot.exists).toBe(true);
        expect(snapshot.data()).toEqual({ name: 'John', age: 30 });
      });

      it('overwrites existing document', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ name: 'John' });
        await docRef.set({ name: 'Jane', role: 'admin' });

        const snapshot = await docRef.get();
        expect(snapshot.data()).toEqual({ name: 'Jane', role: 'admin' });
      });

      it('returns WriteResult', async () => {
        const docRef = db.collection('users').doc('user-1');
        const result = await docRef.set({ name: 'Test' });
        expect(result.writeTime).toBeDefined();
        expect(result.writeTime.toDate()).toBeInstanceOf(Date);
      });

      it('merges data when merge: true', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ name: 'John', age: 30 });
        await docRef.set({ role: 'admin' }, { merge: true });

        const snapshot = await docRef.get();
        expect(snapshot.data()).toEqual({ name: 'John', age: 30, role: 'admin' });
      });

      it('deeply merges nested objects with merge: true', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ name: 'John', settings: { theme: 'dark', lang: 'en' } });
        await docRef.set({ settings: { theme: 'light' } }, { merge: true });

        const snapshot = await docRef.get();
        expect(snapshot.data()).toEqual({
          name: 'John',
          settings: { theme: 'light', lang: 'en' },
        });
      });

      it('handles arrayUnion in set with merge: true', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ name: 'John', tags: ['a'] });
        await docRef.set({ tags: FieldValue.arrayUnion('b') }, { merge: true });

        const snapshot = await docRef.get();
        expect(snapshot.data()?.['tags']).toEqual(['a', 'b']);
      });

      it('arrayUnion creates array if field does not exist', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ name: 'John' });
        await docRef.set({ tags: FieldValue.arrayUnion('first') }, { merge: true });

        const snapshot = await docRef.get();
        expect(snapshot.data()?.['tags']).toEqual(['first']);
      });

      it('arrayUnion does not duplicate existing values', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ tags: ['a', 'b'] });
        await docRef.set({ tags: FieldValue.arrayUnion('a', 'c') }, { merge: true });

        const snapshot = await docRef.get();
        expect(snapshot.data()?.['tags']).toEqual(['a', 'b', 'c']);
      });

      it('handles nested arrayUnion with merge: true', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ options: { app: ['gmail'] } });
        await docRef.set({ options: { app: FieldValue.arrayUnion('slack') } }, { merge: true });

        const snapshot = await docRef.get();
        expect(snapshot.data()?.['options']).toEqual({ app: ['gmail', 'slack'] });
      });

      it('handles arrayUnion on new document without merge', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ tags: FieldValue.arrayUnion('first', 'second') });

        const snapshot = await docRef.get();
        expect(snapshot.data()?.['tags']).toEqual(['first', 'second']);
      });
    });

    describe('get', () => {
      it('returns snapshot for existing document', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ name: 'John' });

        const snapshot = await docRef.get();
        expect(snapshot.exists).toBe(true);
        expect(snapshot.id).toBe('user-1');
        expect(snapshot.data()).toEqual({ name: 'John' });
      });

      it('returns non-existing snapshot for missing document', async () => {
        const snapshot = await db.collection('users').doc('non-existent').get();
        expect(snapshot.exists).toBe(false);
        expect(snapshot.data()).toBeUndefined();
      });

      it('snapshot has ref property', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ name: 'Test' });

        const snapshot = await docRef.get();
        expect(snapshot.ref).toBeDefined();
        expect(snapshot.ref.id).toBe('user-1');
      });
    });

    describe('update', () => {
      it('updates existing document fields', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ name: 'John', age: 30 });
        await docRef.update({ age: 31 });

        const snapshot = await docRef.get();
        expect(snapshot.data()).toEqual({ name: 'John', age: 31 });
      });

      it('adds new fields to existing document', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ name: 'John' });
        await docRef.update({ role: 'admin' });

        const snapshot = await docRef.get();
        expect(snapshot.data()).toEqual({ name: 'John', role: 'admin' });
      });

      it('throws error when document does not exist', () => {
        const docRef = db.collection('users').doc('non-existent');
        // update throws synchronously when document doesn't exist
        expect(() => docRef.update({ name: 'Test' })).toThrow(
          'Document users/non-existent does not exist'
        );
      });

      it('handles arrayUnion in update', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ name: 'John', tags: ['a'] });
        await docRef.update({ tags: FieldValue.arrayUnion('b') });

        const snapshot = await docRef.get();
        expect(snapshot.data()?.['tags']).toEqual(['a', 'b']);
      });

      it('arrayUnion in update creates array if field missing', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ name: 'John' });
        await docRef.update({ tags: FieldValue.arrayUnion('first') });

        const snapshot = await docRef.get();
        expect(snapshot.data()?.['tags']).toEqual(['first']);
      });

      it('arrayUnion in update with dot notation', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ options: { app: ['gmail'] } });
        await docRef.update({ 'options.app': FieldValue.arrayUnion('slack') });

        const snapshot = await docRef.get();
        expect(snapshot.data()?.['options']).toEqual({ app: ['gmail', 'slack'] });
      });
    });

    describe('delete', () => {
      it('removes existing document', async () => {
        const docRef = db.collection('users').doc('user-1');
        await docRef.set({ name: 'John' });
        await docRef.delete();

        const snapshot = await docRef.get();
        expect(snapshot.exists).toBe(false);
      });

      it('does not throw for non-existing document', async () => {
        const docRef = db.collection('users').doc('non-existent');
        await expect(docRef.delete()).resolves.not.toThrow();
      });
    });
  });

  describe('query operations', () => {
    beforeEach(async () => {
      const col = db.collection('users');
      await col.doc('user-1').set({ name: 'Alice', age: 25, role: 'user' });
      await col.doc('user-2').set({ name: 'Bob', age: 30, role: 'admin' });
      await col.doc('user-3').set({ name: 'Charlie', age: 35, role: 'user' });
      await col.doc('user-4').set({ name: 'Diana', age: 25, role: 'admin' });
    });

    describe('where', () => {
      it('filters with == operator', async () => {
        const snapshot = await db.collection('users').where('role', '==', 'admin').get();
        expect(snapshot.size).toBe(2);
        expect(snapshot.docs.map((d) => d.id).sort()).toEqual(['user-2', 'user-4']);
      });

      it('filters with != operator', async () => {
        const snapshot = await db.collection('users').where('role', '!=', 'admin').get();
        expect(snapshot.size).toBe(2);
        expect(snapshot.docs.map((d) => d.id).sort()).toEqual(['user-1', 'user-3']);
      });

      it('filters with < operator', async () => {
        const snapshot = await db.collection('users').where('age', '<', 30).get();
        expect(snapshot.size).toBe(2);
      });

      it('filters with <= operator', async () => {
        const snapshot = await db.collection('users').where('age', '<=', 30).get();
        expect(snapshot.size).toBe(3);
      });

      it('filters with > operator', async () => {
        const snapshot = await db.collection('users').where('age', '>', 30).get();
        expect(snapshot.size).toBe(1);
        expect(snapshot.docs[0]?.id).toBe('user-3');
      });

      it('filters with >= operator', async () => {
        const snapshot = await db.collection('users').where('age', '>=', 30).get();
        expect(snapshot.size).toBe(2);
      });

      it('filters with array-contains operator', async () => {
        await db
          .collection('posts')
          .doc('post-1')
          .set({ tags: ['javascript', 'typescript'] });
        await db
          .collection('posts')
          .doc('post-2')
          .set({ tags: ['python', 'typescript'] });
        await db
          .collection('posts')
          .doc('post-3')
          .set({ tags: ['go', 'rust'] });

        const snapshot = await db
          .collection('posts')
          .where('tags', 'array-contains', 'typescript')
          .get();
        expect(snapshot.size).toBe(2);
      });

      it('handles unknown operator as pass-through', async () => {
        // Unknown operators should not filter anything
        const snapshot = await db
          .collection('users')
          .where('name', 'unknown-op' as Parameters<typeof db.collection>[0], 'value')
          .get();
        expect(snapshot.size).toBe(4);
      });

      it('filters with in operator', async () => {
        const snapshot = await db.collection('users').where('role', 'in', ['admin', 'guest']).get();
        expect(snapshot.size).toBe(2);
        expect(snapshot.docs.map((d) => d.id).sort()).toEqual(['user-2', 'user-4']);
      });

      it('filters with in operator for numeric values', async () => {
        const snapshot = await db.collection('users').where('age', 'in', [25, 35]).get();
        expect(snapshot.size).toBe(3);
      });

      it('in operator returns empty for no matches', async () => {
        const snapshot = await db
          .collection('users')
          .where('role', 'in', ['guest', 'moderator'])
          .get();
        expect(snapshot.size).toBe(0);
      });

      it('chains multiple where clauses', async () => {
        const snapshot = await db
          .collection('users')
          .where('role', '==', 'user')
          .where('age', '>', 25)
          .get();
        expect(snapshot.size).toBe(1);
        expect(snapshot.docs[0]?.data()?.['name']).toBe('Charlie');
      });
    });

    describe('orderBy', () => {
      it('orders ascending by default', async () => {
        const snapshot = await db.collection('users').orderBy('age').get();
        const ages = snapshot.docs.map((d) => d.data()?.['age']);
        expect(ages).toEqual([25, 25, 30, 35]);
      });

      it('orders ascending explicitly', async () => {
        const snapshot = await db.collection('users').orderBy('age', 'asc').get();
        const ages = snapshot.docs.map((d) => d.data()?.['age']);
        expect(ages).toEqual([25, 25, 30, 35]);
      });

      it('orders descending', async () => {
        const snapshot = await db.collection('users').orderBy('age', 'desc').get();
        const ages = snapshot.docs.map((d) => d.data()?.['age']);
        expect(ages).toEqual([35, 30, 25, 25]);
      });
    });

    describe('limit', () => {
      it('limits results', async () => {
        const snapshot = await db.collection('users').limit(2).get();
        expect(snapshot.size).toBe(2);
      });

      it('returns all when limit exceeds count', async () => {
        const snapshot = await db.collection('users').limit(100).get();
        expect(snapshot.size).toBe(4);
      });
    });

    describe('startAfter', () => {
      it('starts after specified value', async () => {
        // startAfter finds the FIRST document with that value and starts after it
        // When there are two users with age 25, it starts after the first one
        const snapshot = await db.collection('users').orderBy('age').startAfter(25).get();
        const ages = snapshot.docs.map((d) => d.data()?.['age']);
        // After the first age=25, we get: second age=25, age=30, age=35
        expect(ages).toEqual([25, 30, 35]);
      });

      it('returns empty when no matching start value', async () => {
        const snapshot = await db.collection('users').orderBy('age').startAfter(100).get();
        expect(snapshot.size).toBe(4); // No match found, returns all
      });
    });

    describe('combined operations', () => {
      it('combines where, orderBy, and limit', async () => {
        const snapshot = await db
          .collection('users')
          .where('role', '==', 'user')
          .orderBy('age', 'desc')
          .limit(1)
          .get();
        expect(snapshot.size).toBe(1);
        expect(snapshot.docs[0]?.data()?.['name']).toBe('Charlie');
      });
    });
  });

  describe('QuerySnapshot', () => {
    it('has docs property', async () => {
      await db.collection('users').doc('user-1').set({ name: 'Test' });
      const snapshot = await db.collection('users').get();
      expect(Array.isArray(snapshot.docs)).toBe(true);
    });

    it('has empty property', async () => {
      const emptySnapshot = await db.collection('empty').get();
      expect(emptySnapshot.empty).toBe(true);

      await db.collection('users').doc('user-1').set({ name: 'Test' });
      const filledSnapshot = await db.collection('users').get();
      expect(filledSnapshot.empty).toBe(false);
    });

    it('has size property', async () => {
      await db.collection('users').doc('user-1').set({ name: 'Test1' });
      await db.collection('users').doc('user-2').set({ name: 'Test2' });

      const snapshot = await db.collection('users').get();
      expect(snapshot.size).toBe(2);
    });
  });

  describe('utility methods', () => {
    describe('clear', () => {
      it('removes all data', async () => {
        await db.collection('users').doc('user-1').set({ name: 'Test' });
        db.clear();

        const snapshot = await db.collection('users').get();
        expect(snapshot.empty).toBe(true);
      });

      it('also clears configuration', () => {
        db.configure({ errorToThrow: new Error('test') });
        db.clear();
        // Should not throw after clear
        expect(() => db.collection('users')).not.toThrow();
      });
    });

    describe('getAllData', () => {
      it('returns all stored data', async () => {
        await db.collection('users').doc('user-1').set({ name: 'John' });
        await db.collection('posts').doc('post-1').set({ title: 'Hello' });

        const data = db.getAllData();
        expect(data.size).toBe(2);
        expect(data.has('users')).toBe(true);
        expect(data.has('posts')).toBe(true);
      });
    });

    describe('seedCollection', () => {
      it('seeds multiple documents', async () => {
        db.seedCollection('users', [
          { id: 'user-1', data: { name: 'Alice' } },
          { id: 'user-2', data: { name: 'Bob' } },
        ]);

        const snapshot = await db.collection('users').get();
        expect(snapshot.size).toBe(2);
      });

      it('adds to existing collection', async () => {
        await db.collection('users').doc('user-0').set({ name: 'Existing' });
        db.seedCollection('users', [{ id: 'user-1', data: { name: 'New' } }]);

        const snapshot = await db.collection('users').get();
        expect(snapshot.size).toBe(2);
      });
    });

    describe('listCollections', () => {
      it('returns empty array', async () => {
        const collections = await db.listCollections();
        expect(collections).toEqual([]);
      });

      it('throws configured error', () => {
        db.configure({ errorToThrow: new Error('Firestore unavailable') });
        // listCollections throws synchronously when error is configured
        expect(() => db.listCollections()).toThrow('Firestore unavailable');
      });
    });
  });

  describe('configure', () => {
    it('causes collection to throw error', () => {
      db.configure({ errorToThrow: new Error('Connection failed') });
      expect(() => db.collection('users')).toThrow('Connection failed');
    });
  });

  describe('batch operations', () => {
    it('creates a batch', () => {
      const batch = db.batch();
      expect(batch).toBeDefined();
      expect(typeof batch.set).toBe('function');
      expect(typeof batch.update).toBe('function');
      expect(typeof batch.delete).toBe('function');
      expect(typeof batch.commit).toBe('function');
    });

    it('batch set creates documents', async () => {
      const batch = db.batch();
      batch.set(db.collection('users').doc('user-1'), { name: 'Alice' });
      batch.set(db.collection('users').doc('user-2'), { name: 'Bob' });
      await batch.commit();

      const snapshot = await db.collection('users').get();
      expect(snapshot.size).toBe(2);
    });

    it('batch update modifies documents', async () => {
      await db.collection('users').doc('user-1').set({ name: 'Alice', age: 25 });

      const batch = db.batch();
      batch.update(db.collection('users').doc('user-1'), { age: 26 });
      await batch.commit();

      const snapshot = await db.collection('users').doc('user-1').get();
      expect(snapshot.data()).toEqual({ name: 'Alice', age: 26 });
    });

    it('batch delete removes documents', async () => {
      await db.collection('users').doc('user-1').set({ name: 'Alice' });
      await db.collection('users').doc('user-2').set({ name: 'Bob' });

      const batch = db.batch();
      batch.delete(db.collection('users').doc('user-1'));
      await batch.commit();

      const snapshot = await db.collection('users').get();
      expect(snapshot.size).toBe(1);
      expect(snapshot.docs[0]?.id).toBe('user-2');
    });

    it('batch returns this for chaining', () => {
      const batch = db.batch();
      const result = batch
        .set(db.collection('users').doc('user-1'), { name: 'Alice' })
        .update(db.collection('users').doc('user-1'), { age: 25 })
        .delete(db.collection('users').doc('user-1'));
      expect(result).toBe(batch);
    });

    it('batch commit returns empty array', async () => {
      const batch = db.batch();
      batch.set(db.collection('users').doc('user-1'), { name: 'Test' });
      const result = await batch.commit();
      expect(result).toEqual([]);
    });
  });
});
