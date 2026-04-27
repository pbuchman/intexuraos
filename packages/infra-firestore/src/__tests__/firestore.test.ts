/**
 * Tests for the Firestore client singleton.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IntexuraOSError } from '@intexuraos/common-core';
import { getFirestore, resetFirestore } from '../firestore.js';

describe('getFirestore', () => {
  const originalProjectId = process.env['INTEXURAOS_GCP_PROJECT_ID'];

  beforeEach(() => {
    resetFirestore();
  });

  afterEach(() => {
    resetFirestore();
    if (originalProjectId === undefined) {
      delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    } else {
      process.env['INTEXURAOS_GCP_PROJECT_ID'] = originalProjectId;
    }
  });

  it('throws IntexuraOSError with MISCONFIGURED/503 when project id env var missing', () => {
    delete process.env['INTEXURAOS_GCP_PROJECT_ID'];
    try {
      getFirestore();
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(IntexuraOSError);
      expect((e as IntexuraOSError).code).toBe('MISCONFIGURED');
      expect((e as IntexuraOSError).httpStatus).toBe(503);
      expect((e as IntexuraOSError).message).toContain('Missing INTEXURAOS_GCP_PROJECT_ID');
    }
  });
});
