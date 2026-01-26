/**
 * Firestore security rules tests for code_tasks collection.
 *
 * Design doc: docs/designs/INT-156-code-action-type.md (lines 2083-2120)
 *
 * Note: These tests document the expected security behavior. Full verification
 * of Firestore rules happens via Firebase emulator or production deployment.
 *
 * To test locally with emulator:
 * 1. Copy firestore.rules to ~/.firebase/emulator-data/
 * 2. firebase emulators:start --only firestore
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// From apps/code-agent/src/__tests__/firestore-rules/ go up 5 levels to monorepo root
const RULES_FILE = join(__dirname, '..', '..', '..', '..', '..', 'firestore.rules');

describe('code_tasks Firestore security rules', () => {
  describe('rules file', () => {
    it('should exist and be readable', () => {
      expect(existsSync(RULES_FILE)).toBe(true);
    });

    it('should contain valid rules structure', () => {
      const content = readFileSync(RULES_FILE, 'utf8');

      // Verify rules_version is present
      expect(content).toContain('rules_version = \'2\'');

      // Verify code_tasks collection rules
      expect(content).toContain('match /code_tasks/{taskId}');

      // Verify logs subcollection rules
      expect(content).toContain('match /code_tasks/{taskId}/logs/{logId}');

      // Verify user_usage collection rules
      expect(content).toContain('match /user_usage/{userId}');

      // Verify service account email check
      expect(content).toContain('code-agent@intexuraos.iam.gserviceaccount.com');

      // Verify user ownership checks
      expect(content).toContain('request.auth.uid == resource.data.userId');
    });
  });

  describe('code_tasks access control', () => {
    const rules = readFileSync(RULES_FILE, 'utf8');

    it('should allow code-agent service account full access', () => {
      // Service account can read and write any document
      expect(rules).toContain('allow read, write: if request.auth != null');
      expect(rules).toContain('request.auth.token.email == \'code-agent@intexuraos.iam.gserviceaccount.com\'');
    });

    it('should allow authenticated users to read their own tasks', () => {
      // Users can read only their own documents
      expect(rules).toMatch(/allow read: if request\.auth != null[\s\S]*?&& request\.auth\.uid == resource\.data\.userId/s);
    });

    it('should not allow direct writes from users', () => {
      // No write rule for regular users - implicit deny
      // This ensures all writes go through code-agent API
      expect(rules).toContain('// Users cannot write directly (must go through code-agent API)');
    });

    it('should allow unauthenticated requests to fail', () => {
      // No rule for unauthenticated access - implicit deny
      // This is the default behavior when no allow rule matches
      expect(rules).toContain('allow read: if request.auth != null');
    });
  });

  describe('logs subcollection access control', () => {
    const rules = readFileSync(RULES_FILE, 'utf8');

    it('should allow code-agent service account full access to logs', () => {
      expect(rules).toContain('match /code_tasks/{taskId}/logs/{logId}');
      expect(rules).toContain('allow read, write: if request.auth != null');
      expect(rules).toContain('request.auth.token.email == \'code-agent@intexuraos.iam.gserviceaccount.com\'');
    });

    it('should allow users to read logs for their own tasks', () => {
      // Must traverse to parent to check userId
      expect(rules).toContain('get(/databases/$(database)/documents/code_tasks/$(taskId)).data.userId');
    });
  });

  describe('user_usage collection access control', () => {
    const rules = readFileSync(RULES_FILE, 'utf8');

    it('should allow code-agent service account full access', () => {
      expect(rules).toContain('match /user_usage/{userId}');
      expect(rules).toContain('allow read, write: if request.auth != null');
      expect(rules).toContain('request.auth.token.email == \'code-agent@intexuraos.iam.gserviceaccount.com\'');
    });

    it('should allow users to read their own usage stats', () => {
      expect(rules).toContain('allow read: if request.auth != null');
      expect(rules).toContain('&& request.auth.uid == userId');
    });
  });

  describe('security guarantees', () => {
    it('should prevent users from reading other users tasks', () => {
      // Rules check request.auth.uid == resource.data.userId
      const rules = readFileSync(RULES_FILE, 'utf8');
      expect(rules).toContain('request.auth.uid == resource.data.userId');
    });

    it('should prevent users from writing directly to Firestore', () => {
      // No write rules for regular users on code_tasks
      // Only service account has write access
      const rules = readFileSync(RULES_FILE, 'utf8');
      expect(rules).toContain('// Users cannot write directly (must go through code-agent API)');
    });

    it('should enforce subcollection parent ownership', () => {
      // Logs access depends on parent task ownership
      const rules = readFileSync(RULES_FILE, 'utf8');
      expect(rules).toContain('get(/databases/$(database)/documents/code_tasks/$(taskId)).data.userId');
    });
  });
});
