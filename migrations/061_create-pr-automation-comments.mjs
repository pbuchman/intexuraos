/**
 * Migration 061: Create pr_automation_comments collection with security rules
 *
 * Stores one document per PR tracking the GitHub comment used for the unified
 * PR automation log (INT-852).
 *
 * Doc ID: `{repository}:{prNumber}` e.g. "pbuchman/intexuraos:42"
 * No composite indexes needed — lookups are by document ID only.
 *
 * Schema:
 *   repository: string     - GitHub repository full name (e.g., "pbuchman/intexuraos")
 *   prNumber: number        - Pull request number
 *   commentId: number       - GitHub comment ID for GET/PATCH
 *   tokenUserId: string     - IntexuraOS user ID whose OAuth token to use
 *   eventCount: number      - Number of events appended to the comment
 *   createdAt: string       - ISO timestamp of first creation
 *   updatedAt: string       - ISO timestamp of last update
 */

export const metadata = {
  id: '061',
  name: 'create-pr-automation-comments',
  description: 'Create pr_automation_comments collection for unified PR automation log',
  createdAt: '2026-03-14',
};

export const rules = {
  collections: {
    'pr_automation_comments/{commentId}': {
      comment: 'PR automation comment tracking for unified PR log',
      get: 'isAuthenticated()',
      getComment: 'No userId field — backend-managed docs, single-owner system',
      list: 'isAuthenticated()\n                  && request.query.limit <= 50',
      listComment: 'CostGuard: Query limit max 50 docs',
      write: 'false',
      writeComment: 'Client cannot write (backend-only via webhook handler)',
    },
  },
};

export async function up(context) {
  console.log('  Deploying pr_automation_comments security rules...');
  await context.deployRules();
}
