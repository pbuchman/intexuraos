# INT-181: Transcription Language Detection and Translations

> Design document for implementing language-aware transcription summaries.

---

## Context

INT-181 requires improving transcription composition:

- Remove markdown formatting from summaries (implemented: strip `###` headers)
- Add introductory phrase in detected language ("Here is a summary of what you said")
- Support Polish with fallback to English

This document captures findings about Speechmatics language detection and proposes an approach for translations across the project.

---

## Current Implementation

### What's Done (This PR)

1. **Strip markdown headers**: Removes `###` from Speechmatics summaries before sending to WhatsApp
2. **Summary format**: Changed from bullets to paragraphs (if configured)

### What's Pending

1. Language detection from Speechmatics response
2. Language-aware intro phrases
3. Translation infrastructure

---

## Speechmatics Language Detection

### API Response Structure

Speechmatics json-v2 response provides language information in two places:

#### 1. Word Alternatives (Most Accurate)

Each word result can include a `language` field in alternatives:

```json
{
  "results": [
    {
      "alternatives": [
        {
          "content": "Hello",
          "confidence": 0.95,
          "language": "en"
        }
      ]
    }
  ]
}
```

**Pros**: Per-word accuracy, handles code-switching
**Cons**: Not always present, depends on transcription config

#### 2. Metadata Language Pack Info (Fallback)

The metadata section contains the language pack used:

```json
{
  "metadata": {
    "language_pack_info": {
      "language_description": "Polish"
    }
  }
}
```

**Pros**: Always present when language is configured
**Cons**: Full language name (not ISO code), requires mapping

### Recommended Extraction Logic

```typescript
function extractDetectedLanguage(response: JsonV2Response): string | undefined {
  // 1. Try word alternatives (most accurate)
  for (const item of response.results) {
    const lang = item.alternatives?.[0]?.language;
    if (lang) return lang;
  }

  // 2. Fallback to metadata
  const description = response.metadata?.language_pack_info?.language_description;
  if (description) {
    const lower = description.toLowerCase();
    if (lower.includes('polish')) return 'pl';
    if (lower.includes('english')) return 'en';
  }

  return undefined;
}
```

### Testing Requirements

1. Mock responses with `language` in word alternatives
2. Mock responses with only metadata (no per-word language)
3. Mock responses with neither (undefined language)
4. Polish language detection from "Polish" description
5. English language detection from word alternatives

---

## Translation Infrastructure

### Current State

No translation infrastructure exists. All user-facing strings are hardcoded in English.

### Proposed Approach

#### Option A: Simple String Map (Recommended for Now)

For limited scope (transcription intro phrases only):

```typescript
// apps/whatsapp-service/src/domain/whatsapp/translations.ts
const TRANSLATIONS = {
  'transcription.summary_intro': {
    en: 'Here is a summary of what you said:',
    pl: 'Oto podsumowanie tego, co powiedziałeś:',
  },
} as const;

type TranslationKey = keyof typeof TRANSLATIONS;
type SupportedLanguage = 'en' | 'pl';

export function t(key: TranslationKey, lang: SupportedLanguage = 'en'): string {
  return TRANSLATIONS[key][lang] ?? TRANSLATIONS[key]['en'];
}
```

**Pros**: Simple, no dependencies, type-safe
**Cons**: Doesn't scale, no pluralization, no interpolation

#### Option B: i18n Library (Future)

For broader translation needs, consider:

- **i18next**: Most popular, works in Node.js and browser
- **@formatjs/intl**: ICU message format, good for pluralization
- **typesafe-i18n**: TypeScript-first, compile-time safety

**When to adopt**: When translation needs extend beyond whatsapp-service or require complex formatting.

### Translation Scope Analysis

| Service          | User-Facing Strings                    | Priority |
| ---------------- | -------------------------------------- | -------- |
| whatsapp-service | Transcription messages, error messages | High     |
| web app          | All UI text                            | Medium   |
| commands-agent   | Classification feedback                | Low      |
| Other agents     | Mostly internal                        | Low      |

### Recommended Phased Approach

1. **Phase 1 (This PR)**: No translation, just strip markdown
2. **Phase 2**: Add simple translation map for whatsapp-service transcription messages
3. **Phase 3**: Evaluate i18n library if translation needs grow

---

## Implementation Plan for Phase 2

### Files to Modify

1. **New file**: `apps/whatsapp-service/src/domain/whatsapp/translations.ts`
   - Translation map and `t()` function

2. **Modify**: `apps/whatsapp-service/src/domain/whatsapp/ports/transcription.ts`
   - Add `detectedLanguage?: string` to `TranscriptionTextResult`

3. **Modify**: `apps/whatsapp-service/src/infra/speechmatics/adapter.ts`
   - Add `extractDetectedLanguage()` method
   - Include `detectedLanguage` in response

4. **Modify**: `apps/whatsapp-service/src/domain/whatsapp/usecases/transcribeAudio.ts`
   - Pass `detectedLanguage` through workflow
   - Use `t()` for intro phrase in `sendSuccessMessage`

5. **Modify**: `apps/whatsapp-service/src/__tests__/fakes.ts`
   - Add `detectedLanguage` to fake transcription port

6. **Add tests**: Language detection and translation tests

### Estimated Effort

- Phase 2 implementation: 2-3 hours
- Testing: 1-2 hours
- Total: 3-5 hours

---

## Open Questions

### Q1: Language Fallback Order

**Current assumption**: Polish -> English (per INT-181 description)

**Alternative**: English -> Polish (more common default)

**Recommendation**: Follow user's instruction - Polish first, English fallback.

### Q2: Full Transcript Language vs Summary Language

Should the intro phrase match:

- A) Language of the full transcript
- B) Always use detected language from Speechmatics
- C) User preference setting

**Recommendation**: Use Speechmatics detected language (B) for simplicity.

### Q3: Error Message Translation

Should error messages also be translated?

**Recommendation**: No for now - error messages are technical and benefit from being in English for debugging.

---

## References

- [INT-181](https://linear.app/pbuchman/issue/INT-181/improve-transcription-composition-and-formatting) - Parent issue
- [INT-195](https://linear.app/pbuchman/issue/INT-195/design-int-181-transcription-composition-open-questions) - Design questions issue
- [Speechmatics Batch API Docs](https://docs.speechmatics.com/introduction/batch-guide)
- Previous PR #546 (closed) - Implementation attempt

---

**Last updated:** 2026-01-21
