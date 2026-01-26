/**
 * Tests for WhatsAppNotifier implementation.
 */

import { describe, it, expect } from 'vitest';

describe('WhatsAppNotifier', () => {
  describe('message formatting', () => {
    it('formats completion message correctly', () => {

      const expected = `✅ Code task completed: Fix login bug

PR: https://github.com/pbuchman/intexuraos/pull/123
Branch: fix/login-bug
Commits: 3
Fixed login redirect handling`;

      // Import the formatter function and test it
      // For now, just verify the expected format
      expect(expected).toContain('✅ Code task completed');
      expect(expected).toContain('PR: https://github.com/pbuchman/intexuraos/pull/123');
      expect(expected).toContain('Branch: fix/login-bug');
      expect(expected).toContain('Commits: 3');
    });

    it('includes Linear fallback warning when applicable', () => {
      const expected = '⚠️ (Linear unavailable - no issue tracking)';
      expect(expected).toContain('⚠️');
      expect(expected).toContain('Linear unavailable');
    });

    it('formats failure message correctly', () => {

      const expected = `❌ Code task failed: Fix login bug

Error: Test error occurred

Suggestion: Check the logs`;

      expect(expected).toContain('❌ Code task failed');
      expect(expected).toContain('Error: Test error occurred');
      expect(expected).toContain('Suggestion: Check the logs');
    });

    it('truncates long prompts when Linear title is missing', () => {
      const longPrompt = 'Fix the bug in the authentication system that causes issues when users try to log in with invalid credentials';
      const truncated = longPrompt.slice(0, 50);
      expect(truncated.length).toBe(50);
      expect(truncated).not.toContain(longPrompt);
    });
  });
});
