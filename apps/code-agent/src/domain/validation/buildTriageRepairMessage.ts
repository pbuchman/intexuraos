// Prompt version: 2.0.0
export function buildTriageRepairMessage(
  state: { skipped: boolean; skipReason: string | undefined; reviewsRequested: string[] },
): string {
  const toolsAlreadyCalled = state.skipped || state.reviewsRequested.length > 0;

  if (toolsAlreadyCalled) {
    return [
      'Your tool calls have been recorded successfully.',
      '',
      `CURRENT STATE: ${JSON.stringify(state)}`,
      '',
      'Your triage decision is complete. Do NOT call any more tools.',
      'Respond with ONLY a brief text summary of your decision.',
    ].join('\n');
  }

  return [
    'Your triage decision is incomplete. No tool was called.',
    '',
    `CURRENT STATE: ${JSON.stringify(state)}`,
    '',
    'You MUST call exactly one tool:',
    '- skip(reason): if no review needed',
    '- request_review(review_type): if review is needed',
    '',
    'Call the tool, then respond with a brief text summary.',
  ].join('\n');
}
