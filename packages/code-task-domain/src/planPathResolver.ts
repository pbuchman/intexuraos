import { posix } from 'node:path';

const PLAN_DOCUMENT_LINE_REGEX = /^Plan document:\s*(.+)$/gim;
const PLAN_DOCUMENT_PATH_REGEX = /docs\/plans\/[^\s)\]>'"]+?\.md\b/g;

export interface PlanResolutionContext {
  description: string | undefined; // @allow-undefined-type -- exactOptionalPropertyTypes: callers must always provide the key
  comments: { body: string }[];
}

function normalizePlanDocumentPath(candidate: string): string | undefined {
  const normalized = posix.normalize(candidate.trim());
  if (
    normalized.startsWith('/') ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    !normalized.startsWith('docs/plans/') ||
    !normalized.endsWith('.md')
  ) {
    return undefined;
  }

  return normalized;
}

function extractPlanDocumentPathCandidate(text: string): string | undefined {
  for (const match of text.matchAll(PLAN_DOCUMENT_PATH_REGEX)) {
    const normalized = normalizePlanDocumentPath(match[0]);
    if (normalized !== undefined) return normalized;
  }

  return undefined;
}

function extractCanonicalPlanDocumentPath(text: string): string | undefined {
  const canonicalLineRegex = new RegExp(PLAN_DOCUMENT_LINE_REGEX);

  for (
    let match = canonicalLineRegex.exec(text);
    match !== null;
    match = canonicalLineRegex.exec(text)
  ) {
    const normalized = extractPlanDocumentPathCandidate(String(match[1]));
    if (normalized !== undefined) return normalized;
  }

  return undefined;
}

export function resolvePlanDocumentPathFromLinearContext(
  context: PlanResolutionContext
): string | undefined {
  const description = context.description ?? '';

  const descriptionCanonical = extractCanonicalPlanDocumentPath(description);
  if (descriptionCanonical !== undefined) return descriptionCanonical;

  for (const comment of context.comments) {
    const commentCanonical = extractCanonicalPlanDocumentPath(comment.body);
    if (commentCanonical !== undefined) return commentCanonical;
  }

  const descriptionFallback = extractPlanDocumentPathCandidate(description);
  if (descriptionFallback !== undefined) return descriptionFallback;

  for (const comment of context.comments) {
    const commentFallback = extractPlanDocumentPathCandidate(comment.body);
    if (commentFallback !== undefined) return commentFallback;
  }

  return undefined;
}
