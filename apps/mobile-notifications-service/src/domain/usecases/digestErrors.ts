export type DigestError =
  | { readonly code: 'input-invalid'; readonly message: string }
  | { readonly code: 'llm-call-failed'; readonly message: string }
  | { readonly code: 'zod-validation-failed'; readonly message: string }
  | { readonly code: 'repair-exhausted'; readonly attempts: number; readonly lastResponse: string };

export function inputInvalid(message: string): DigestError {
  return { code: 'input-invalid', message };
}

export function llmCallFailed(message: string): DigestError {
  return { code: 'llm-call-failed', message };
}

export function zodValidationFailed(message: string): DigestError {
  return { code: 'zod-validation-failed', message };
}

export function repairExhausted(attempts: number, lastResponse: string): DigestError {
  return { code: 'repair-exhausted', attempts, lastResponse };
}
