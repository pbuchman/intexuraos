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

- **Term**: `IntexuraOS`
- **Sounds Like**: `['in tex ura o s', 'in tex ura os', 'inteksura os']` (Phonetic variations for PL/EN)

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
