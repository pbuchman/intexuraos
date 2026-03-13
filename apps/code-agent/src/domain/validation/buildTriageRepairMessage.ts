// Prompt version: 1.0.0
export function buildTriageRepairMessage(
  invalidState: { skipped: boolean; skipReason: string | undefined; reviewsRequested: string[] },
  errorMessage: string,
): string {
  return `Your triage decision is incomplete. ${errorMessage}

CURRENT STATE: ${JSON.stringify(invalidState)}

You MUST call exactly one tool:
- skip(reason): if no review needed — reason is shown to the PR author
- request_review(review_type): if review is needed

Call the tool NOW, then provide a brief text summary.`;
}
