# Speechmatics Integration Enhancements

## Objective

Enhance the existing speech transcription service (Speechmatics) to provide a superior user experience by implementing summarization, custom vocabulary (IntexuraOS), and robust mixed-language handling.

## Problem Statement

The current transcription implementation is functional but lacks polish:

1.  **Recognition**: "IntexuraOS" is often misrecognized.
2.  **Formatting**: Long sentences are broken into short, disjointed statements.
3.  **Verbosity**: Raw transcripts of repetitive voice notes are hard to digest.
4.  **Language**: Polish and English usage is mixed, requiring robust detection.

## Desired User Experience

- **Accurate Brand Recognition**: The system correctly identifies "IntexuraOS" in voice notes.
- **Smart Summaries**: Instead of (or in addition to) a wall of text, the user receives a concise summary of the voice note, especially for long or repetitive ramblings.
- **Seamless Language Support**: The user can speak Polish, English, or a mix, and the system handles it gracefully without manual toggles.
- **Readable Output**: Transcripts flow naturally with proper sentence structure.

## Technical Strategy

### 1. Custom Vocabulary (Entity Recognition)

Leverage Speechmatics' `additional_vocab` feature to inject domain-specific terms.

**Configuration:**

```json
[
  {
    "content": "IntexuraOS",
    "sounds_like": ["in tex ura o s", "in tech sura o s", "inteksura os", "in texture os"]
  },
  { "content": "pbuchman", "sounds_like": ["p buck man", "p book man", "piotr buchman"] },
  { "content": "pnpm", "sounds_like": ["p n p m", "pin pm", "pee en pee em", "performant npm"] },
  { "content": "tf", "sounds_like": ["tea eff", "terraform"] },
  { "content": "gh", "sounds_like": ["gee aitch", "git hub"] },
  { "content": "ci:tracked", "sounds_like": ["see eye tracked", "c i tracked"] },
  { "content": "service-scribe", "sounds_like": ["service scribe"] },
  { "content": "sentry-triage", "sounds_like": ["sentry tree ahj", "sentry try age"] },
  { "content": "coverage-orchestrator", "sounds_like": ["coverage orchestrator"] },
  { "content": "promptvault", "sounds_like": ["prompt vault"] },
  { "content": "z.ai", "sounds_like": ["zed dot a i", "zee dot a i", "zai", "the ai"] },
  { "content": "GLM-4.7", "sounds_like": ["gee el em four point seven"] },
  { "content": "Linear", "sounds_like": ["line ear", "linear app"] },
  { "content": "Auth0", "sounds_like": ["auth zero", "oauth"] },
  { "content": "Firestore", "sounds_like": ["fire store"] },
  { "content": "Pub/Sub", "sounds_like": ["pub sub", "publish subscribe"] },
  { "content": "Vite", "sounds_like": ["veet", "vight"] },
  { "content": "Vitest", "sounds_like": ["veet test", "vight test"] },
  { "content": "Fastify", "sounds_like": ["fast if i"] },
  { "content": "Bun", "sounds_like": ["bun", "bunn"] },
  { "content": "Bunx", "sounds_like": ["bun x", "bunks"] },
  { "content": "Speechmatics", "sounds_like": ["speech matics"] },
  { "content": "Perplexity Sonar", "sounds_like": ["perplexity sonar"] },
  { "content": "Claude Opus", "sounds_like": ["cloud opus", "claude opus"] },
  { "content": "SemVer", "sounds_like": ["sem ver", "semantic versioning"] },
  { "content": "JWKS", "sounds_like": ["jay double you kay ess", "j w k s"] },
  { "content": "scaffolded", "sounds_like": ["scaffold it", "ska folded"] },
  { "content": "wygaszać", "sounds_like": ["vi ga shatch", "ve ga shatch"] },
  { "content": "zaakceptujemy", "sounds_like": ["za ak cep tu ye my", "zah ak cep tu jemy"] },
  { "content": "kliknięcia", "sounds_like": ["click nien cia", "klik nien cia"] },
  { "content": "kontenerze", "sounds_like": ["con ten er zhe", "kontenerze"] },
  { "content": "sprawdzenie", "sounds_like": ["sprav dze nie"] },
  { "content": "zapasów", "sounds_like": ["za pa soof", "zapasuv"] },
  { "content": "grupować", "sounds_like": ["group o vatch"] },
  { "content": "delikatny", "sounds_like": ["deli cat ny"] },
  { "content": "actions-agent", "sounds_like": ["actions agent"] },
  { "content": "research-agent", "sounds_like": ["research agent"] },
  { "content": "commands-agent", "sounds_like": ["commands agent"] },
  { "content": "data-insights-agent", "sounds_like": ["data insights agent"] },
  { "content": "bookmarks-agent", "sounds_like": ["bookmarks agent"] },
  { "content": "todos-agent", "sounds_like": ["to dos agent", "todos agent"] },
  { "content": "web-agent", "sounds_like": ["web agent"] },
  { "content": "api-docs-hub", "sounds_like": ["api docs hub"] },
  { "content": "smart-dispatch", "sounds_like": ["smart dispatch"] },
  { "content": "Cloud Run", "sounds_like": ["cloud run"] },
  { "content": "Cloud Build", "sounds_like": ["cloud build"] },
  { "content": "Workload Identity", "sounds_like": ["workload identity"] },
  { "content": "Kanban", "sounds_like": ["can ban", "kahn bahn"] },
  { "content": "TDD", "sounds_like": ["tee dee dee"] },
  { "content": "commitować", "sounds_like": ["commit o vatch"] },
  { "content": "merge'ować", "sounds_like": ["merge o vatch"] },
  { "content": "pushować", "sounds_like": ["push o vatch"] }
]
```

### 2. Summarization

Enable the `summarization_config` in the Batch API.

- **Type**: `bullets` (for actionable clarity) or `paragraphs` (for narrative flow).
- **Length**: `brief`.
- **Content Type**: `informative`.
- **Integration**: Request `json-v2` format output to receive both the full transcript (for search/indexing) and the summary (for display/notification).

### 3. Mixed Language & Formatting

- **Language Config**: Explicitly set `language: 'auto'` (Language Identification).
- **Punctuation**: The `enhanced` operating point typically handles punctuation well, but we can explore `punctuation_overrides` if "choppy" sentences persist.
  - _Note_: "Breaking long sentences" is often a result of aggressive silence detection or specific model behavior. We will test if `enhanced` model + `auto` language improves this naturally.

## Implementation Steps

### Phase 1: Domain & Types

1.  **Update `TranscriptionTextResult`**: Add optional `summary` field to the domain model in `apps/whatsapp-service/src/domain/whatsapp/ports/transcription.ts`.
2.  **Update Config Types**: Ensure internal configuration interfaces support passing custom vocab and summarization preferences if we want them dynamically configurable.

### Phase 2: Speechmatics Adapter Upgrade

1.  **Refactor `submitJob`**:
    - Inject `additional_vocab` with "IntexuraOS".
    - Add `summarization_config`.
    - Ensure `language` defaults to `auto`.
2.  **Refactor `getTranscript`**:
    - Switch from fetching plain text (`text`) to fetching `json-v2`.
    - Parse the JSON to extract:
      - `results.results` (reconstruct full text).
      - `summary.content` (extract summary).
    - Handle fallback if summary is missing.

### Phase 3: Service & Persistence Layers

1.  **Firestore Schema**: Ensure the `WhatsAppMessage` or `TranscriptionState` model in Firestore can store the `summary`.
2.  **Event Handling**: Update `TranscribeAudioUseCase` to propagate the summary in the `TranscriptionCompletedEvent` or directly update the message repository.
3.  **Search Indexing**: (Optional) Index the summary in Algolia/Firestore for quicker retrieval.

### Phase 4: UI/UX Updates

1.  **WhatsApp Response**:
    - When a transcription completes, update the message display logic.
    - If a summary exists, consider sending a follow-up message or updating the view to show **Summary** first, with **Full Transcript** behind a "Read More" or separate section.
2.  **Web/CLI**: Update any frontend views to display the summary field.

## Verification Plan

1.  **Unit Tests**: Update `speechmaticsAdapter.test.ts` to mock `json-v2` responses and verify summary extraction.
2.  **Integration Test**:
    - Record a sample audio file saying: _"Hello, this is a test for IntexuraOS. I am speaking in English but... teraz mówię po polsku żeby sprawdzić co się stanie."_
    - Run the transcription.
    - Verify:
      - "IntexuraOS" is spelled correctly.
      - Polish and English are both captured.
      - A summary is generated.
