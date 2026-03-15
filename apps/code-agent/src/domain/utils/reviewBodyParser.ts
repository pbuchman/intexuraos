/**
 * Detects whether a pull_request_review body contains actionable findings.
 *
 * Used by CodeWorkerOutputRule to distinguish clean reviews (skip)
 * from reviews with suggestions that need enforcement (dispatch).
 */

const CLEAN_REVIEW_INDICATORS = [
  'no issues found',
  'no code quality issues were identified',
  'no issues identified',
  'no significant issues',
];

export function hasActionableFindings(body: string | null): boolean {
  if (body === null || body.trim() === '') {
    return false;
  }

  const lower = body.toLowerCase();

  for (const indicator of CLEAN_REVIEW_INDICATORS) {
    if (lower.includes(indicator)) {
      return false;
    }
  }

  // Default: true (dispatch when uncertain — the worker can triage)
  return true;
}
