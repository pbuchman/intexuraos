import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('no-unbounded-firestore-get', () => {
  it('blocks unbounded collection gets and allows bounded reads', () => {
    const { RuleTester } = require('eslint');
    const rule = require('../no-unbounded-firestore-get.cjs');
    const tester = new RuleTester({
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    });

    expect(() =>
      tester.run('no-unbounded-firestore-get', rule, {
        valid: [
          "await db.collection('users').doc(userId).get();",
          "await db.collection('users').limit(10).get();",
          "await db.collection('users').where('active', '==', true).get();",
          "await db.collection('users').orderBy('createdAt').limit(25).get();",
          "await db.collection('doc_embeddings').findNearest('embedding', vector, { limit: 10, distanceMeasure: 'COSINE' }).get();",
          "const query = db.collection('users').where('active', '==', true); await query.get();",
          "const ref = db.collection('users').doc(userId); await ref.get();",
        ],
        invalid: [
          {
            code: "await db.collection('users').get();",
            errors: [{ messageId: 'unboundedGet' }],
          },
          {
            code: "await firestore.collection('users').orderBy('createdAt').get();",
            errors: [{ messageId: 'unboundedGet' }],
          },
          {
            code: "await db.collection('users').doc(userId).collection('posts').get();",
            errors: [{ messageId: 'unboundedGet' }],
          },
          {
            code: "const posts = db.collection('users').doc(userId).collection('posts'); await posts.get();",
            errors: [{ messageId: 'unboundedGet' }],
          },
          {
            code: "const query = db.collection('users'); await query.get();",
            errors: [{ messageId: 'unboundedGet' }],
          },
        ],
      })
    ).not.toThrow();
  });
});
