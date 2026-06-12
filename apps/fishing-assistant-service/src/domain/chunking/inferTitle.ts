import { normalizePageText } from './normalizePageText.js';
import type { TitleInferencePort } from './types.js';

function isHeaderLike(line: string): boolean {
  if (line.length === 0 || line.length > 120) return false;
  if (line.startsWith('- ')) return false;
  if (/[.!?]$/.test(line)) return false;
  return true;
}

export async function inferTitle(
  rawText: string,
  options: { generateTitle?: TitleInferencePort['generateTitle'] } = {}
): Promise<string> {
  const normalized = normalizePageText(rawText);
  const header = normalized
    .split('\n')
    .map((line) => line.trim())
    .find(isHeaderLike);

  if (header !== undefined) return header;

  if (options.generateTitle !== undefined) {
    const generated = await options.generateTitle(normalized);
    const trimmed = generated.trim();
    if (trimmed.length > 0) return trimmed;
  }

  return 'Untitled fishing page';
}
