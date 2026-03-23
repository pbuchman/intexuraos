# Hellscript Categorized Writing Config

## Summary

Replace per-buffer writing samples, style instructions, and audience with a user-level writing configuration system. Users manage style instructions and writing samples through dedicated UI pages, categorized by target platform: Threads, LinkedIn, and General (long-form). At draft time, the intent interpreter resolves the target category from the utterance, and the system pulls the relevant style/samples into the prompt.

## Motivation

- Writing style and samples are user-level concerns, not buffer-level — they should persist across conversations
- Users need explicit control over their style library rather than relying on conversational accumulation
- Categories enable platform-specific drafts from the same set of thoughts
- Future external agents may modify writing config via internal HTTP endpoints

## Assumptions

- Hellscript is in early development with no real user data. Deleting all `hellscript_buffers` documents is acceptable.
- `WritingSample.category` is immutable after creation. To change category, delete and recreate.
- No maxLength on `text` fields for style instructions or writing samples. Users may paste several A4 pages. Token cost is the user's responsibility — the LLM prompt will naturally fail if input is too large. Title has maxLength 200.

## Domain Model

### WritingCategory (hardcoded enum)

```typescript
type WritingCategory = 'threads' | 'linkedin' | 'general';
```

Not user-configurable. Three values only, enforced at code level.

### WritingStyleConfig (parent document)

```typescript
interface WritingStyleConfig {
  userId: string;
  threadsStyle: string | null;
  linkedinStyle: string | null;
  generalStyle: string | null;
  createdAt: string;  // ISO 8601
  updatedAt: string;  // ISO 8601
}
```

Three explicit fields (not a map) to avoid `noUncheckedIndexedAccess` issues.

### WritingSample (subcollection document)

```typescript
interface WritingSample {
  id: string;
  category: WritingCategory;  // immutable after creation
  text: string;
  title: string;
  createdAt: string;  // ISO 8601
  updatedAt: string;  // ISO 8601
}
```

Maximum 5 samples per category, enforced at use case level.

### MaterializedBufferState (slimmed down)

```typescript
interface MaterializedBufferState {
  thoughts: ThoughtEntry[];
}
```

Removed: `writingSamples`, `styleInstructions`, `audience`, `contentGoal`.

### IntentKind (reduced)

```typescript
type IntentKind =
  | 'append_thought'
  | 'delete_thought'
  | 'reorder_thoughts'
  | 'update_draft'
  | 'fallback_append';
```

Removed: `add_writing_sample`, `set_style_instructions`, `set_metadata`.

The `update_draft` payload now includes `category: WritingCategory | null`. Null means the interpreter couldn't resolve the category — triggers `action: 'category_required'` response. Category is extracted from `intent.payload['category']` using the existing `Record<string, unknown>` pattern with a runtime validation check (same approach as `intent.payload['text']`).

## Firestore Structure

### New collection: `hellscript_writing_config`

Owner: `hellscript-agent`. Must be registered in `firestore-collections.json`.

```
hellscript_writing_config/{userId}
  ├── threadsStyle: string | null
  ├── linkedinStyle: string | null
  ├── generalStyle: string | null
  ├── createdAt: string (ISO 8601)
  └── updatedAt: string (ISO 8601)

  └── writing_samples/{sampleId}
      ├── category: "threads" | "linkedin" | "general"
      ├── title: string
      ├── text: string
      ├── createdAt: string (ISO 8601)
      └── updatedAt: string (ISO 8601)
```

### Data cleanup

Delete all documents in `hellscript_buffers` collection (including subcollections `events` and `draft_versions`) to remove stale fields. This is acceptable because hellscript is in early development with no real user data.

## Ports

### New: WritingConfigRepository

```typescript
interface WritingConfigRepository {
  getStyleConfig(userId: string): Promise<Result<WritingStyleConfig | null>>;
  upsertStyleInstructions(userId: string, category: WritingCategory, text: string): Promise<Result<void>>;
  deleteStyleInstructions(userId: string, category: WritingCategory): Promise<Result<void>>;
  listSamples(userId: string, category: WritingCategory): Promise<Result<WritingSample[]>>;
  getSample(userId: string, sampleId: string): Promise<Result<WritingSample | null>>;
  createSample(userId: string, sample: Omit<WritingSample, 'id' | 'createdAt' | 'updatedAt'>): Promise<Result<WritingSample>>;
  updateSample(userId: string, sampleId: string, category: WritingCategory, text: string, title: string): Promise<Result<void>>;
  deleteSample(userId: string, sampleId: string, category: WritingCategory): Promise<Result<void>>;
  countSamplesByCategory(userId: string, category: WritingCategory): Promise<Result<number>>;
}
```

Implemented by `FirestoreWritingConfigRepository` in `infra/firestore/`.

### Modified: DraftGenerator

```typescript
interface DraftGenerator {
  generate(
    state: MaterializedBufferState,
    priorDraft: string | null,
    requestText: string,
    styleInstructions: string | null,
    writingSamples: string[],
    category: WritingCategory,
    logger: Logger
  ): Promise<Result<string>>;
}
```

Breaking change: 3 new parameters added before `logger`. All implementations must be updated:
- `GeminiDraftGenerator` — update to accept and use new parameters
- `FakeDraftGenerator` (in tests) — update to match new signature
- All test callsites that mock or fake `DraftGenerator`

### Unchanged: IntentInterpreter

```typescript
interface IntentInterpreter {
  interpret(
    utterance: string,
    currentState: MaterializedBufferState,
    logger: Logger
  ): Promise<InterpretedIntent>;
}
```

Signature unchanged. The `currentState` parameter is now thoughts-only (slimmed `MaterializedBufferState`). The interpreter prompt is updated to remove writing samples/style/audience/contentGoal sections and to instruct the LLM to resolve `category` from the utterance for `update_draft` intents. The three available categories are hardcoded in the prompt text.

## Service Container Changes

### ServiceContainer

```typescript
interface ServiceContainer {
  hellscriptRepository: HellscriptRepository;
  writingConfigRepository: WritingConfigRepository;  // NEW
  intentInterpreter: IntentInterpreter;
  draftGenerator: DraftGenerator;
  logger: Logger;
}
```

### ServiceConfig

```typescript
interface ServiceConfig {
  geminiClient: GeminiClient;
  logger: Logger;
}
```

Unchanged — `FirestoreWritingConfigRepository` uses `getFirestore()` directly (same pattern as `FirestoreHellscriptRepository`).

### initServices

Add `writingConfigRepository: new FirestoreWritingConfigRepository()` to the container initialization.

### ImposeOnBufferDeps

```typescript
interface ImposeOnBufferDeps {
  repository: HellscriptRepository;
  writingConfigRepository: WritingConfigRepository;  // NEW
  interpreter: IntentInterpreter;
  draftGenerator: DraftGenerator;
  logger: Logger;
}
```

The `imposeOnBuffer` use case already has `input.userId` — it uses this to call `writingConfigRepository.getStyleConfig()` and `writingConfigRepository.listSamples()` when the intent is `update_draft`.

## Use Cases

### New (writing config CRUD)

- `getWritingConfig(deps, userId)` — returns full WritingStyleConfig, creates default if none exists
- `updateStyleInstructions(deps, userId, category, text)` — upserts style for a category, sanitizes input
- `clearStyleInstructions(deps, userId, category)` — sets category style to null
- `listWritingSamples(deps, userId, category)` — returns samples for a category
- `createWritingSample(deps, userId, category, title, text)` — creates sample, enforces max-5, sanitizes
- `updateWritingSample(deps, userId, sampleId, category, title, text)` — updates sample, validates sample belongs to specified category (404 if mismatch), sanitizes
- `deleteWritingSample(deps, userId, sampleId, category)` — deletes a sample, validates sample belongs to specified category (404 if mismatch)

### Modified: imposeOnBuffer

When `update_draft` intent fires:
1. Extract `category` from `intent.payload['category']` with runtime type check against `WritingCategory` values
2. If `category` is null or invalid, return `{ action: 'category_required' }`
3. Fetch style instructions via `writingConfigRepository.getStyleConfig(input.userId)` and extract the field for the resolved category
4. Fetch samples via `writingConfigRepository.listSamples(input.userId, category)`
5. Pass style instructions string, sample texts array, and category to `draftGenerator.generate()` alongside the thoughts-only state

### Code removal in applyIntentToState

Remove these branches from the switch statement and their helper functions:
- `case 'add_writing_sample':` → delete `addWritingSample()` helper
- `case 'set_style_instructions':` → delete `setStyleInstructions()` helper
- `case 'set_metadata':` → delete `setMetadata()` helper
- Keep `extractStringArray()` helper — still used by `reorderThoughts`

Remove these fields from `MaterializedBufferState`:
- `writingSamples: string[]`
- `styleInstructions: string | null`
- `audience: string | null`
- `contentGoal: string | null`

Update `emptyState()` to return only `{ thoughts: [] }`.

## API Endpoints

### New endpoints

#### GET /hellscript/writing-config

Response:
```json
{
  "success": true,
  "data": {
    "userId": "...",
    "threadsStyle": "..." | null,
    "linkedinStyle": "..." | null,
    "generalStyle": "..." | null,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

#### PUT /hellscript/writing-config/:category/style

`:category` validated against `WritingCategory` enum. Invalid → 400.

Request body:
```json
{ "text": "..." }
```
- `text`: string, required, minLength 1

Response: `{ "success": true }`

#### DELETE /hellscript/writing-config/:category/style

Response: `{ "success": true }`

#### GET /hellscript/writing-config/:category/samples

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "category": "threads",
      "title": "...",
      "text": "...",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

#### POST /hellscript/writing-config/:category/samples

Request body:
```json
{ "title": "...", "text": "..." }
```
- `title`: string, required, minLength 1, maxLength 200
- `text`: string, required, minLength 1

Returns 409 if 5 samples already exist for the category.

Response:
```json
{
  "success": true,
  "data": { "id": "...", "category": "...", "title": "...", "text": "...", "createdAt": "...", "updatedAt": "..." }
}
```

#### PUT /hellscript/writing-config/:category/samples/:sampleId

Request body:
```json
{ "title": "...", "text": "..." }
```
- `title`: string, required, minLength 1, maxLength 200
- `text`: string, required, minLength 1

Returns 404 if sample not found.

Response: `{ "success": true }`

#### DELETE /hellscript/writing-config/:category/samples/:sampleId

Returns 404 if sample not found.

Response: `{ "success": true }`

### Modified endpoints

- `POST /hellscript/impose` — response may include `action: 'category_required'`. The web app should display a message prompting the user to specify which platform they want the draft for (e.g., "Please specify the target platform: Threads, LinkedIn, or a general article").

### Unchanged endpoints

- `GET /hellscript/buffers`
- `GET /hellscript/buffers/:id` — workspace state drops removed fields

## Prompt Changes

### interpret-impose-prompt (v2.0.0)

- Remove `<buffer_writing_samples>`, `<buffer_style_instructions>`, `<buffer_audience>`, `<buffer_content_goal>` sections from buffer state display
- Buffer state section shows only `<buffer_thoughts>`
- Remove `add_writing_sample`, `set_style_instructions`, `set_metadata` from available intents list
- `update_draft` intent description updated: payload must include `"category": "threads" | "linkedin" | "general" | null`
- Add instruction: "If the user wants to generate a draft but does not specify or imply a target platform, set category to null"

### generate-draft-prompt (v2.0.0)

Input type changes from `GenerateDraftPromptInput` to:

```typescript
interface GenerateDraftPromptInput {
  state: MaterializedBufferState;  // thoughts only
  priorDraft: string | null;
  requestText: string;
  styleInstructions: string | null;
  writingSamples: string[];
  category: WritingCategory;
}
```

Prompt sections:
- `<user_thoughts>` — unchanged (bullet list of thoughts)
- `<style_instructions>` — from user's saved config for the category (or omitted if null)
- `<writing_samples>` — from user's saved samples for the category (or omitted if empty)
- `<target_platform>` — category with description: "threads" → "Threads (threads.com) — short, punchy social post", "linkedin" → "LinkedIn — professional social network post", "general" → "General — long-form article or story (e.g., Medium)"
- `<prior_draft>` — unchanged
- `<user_request>` — unchanged

Sanitization: all user-provided text (style instructions and sample content) has XML-like tags escaped (`<` → `&lt;`, `>` → `&gt;`) before insertion into prompt XML blocks. Existing prompt injection defense instruction retained.

## Web App Changes

### Route ordering

The existing `/hellscript/:id` catch-all param route would match `/hellscript/voice` and `/hellscript/scriptures`. The new static routes must be registered BEFORE the `:id` param route in `App.tsx` so React Router matches them first.

### Sidebar additions

```typescript
{ to: '/hellscript/voice', label: 'Voice of the Damned', icon: PenTool }
{ to: '/hellscript/scriptures', label: 'Sacred Scriptures', icon: FileText }
```

### New pages

**HellscriptStylePage** (`/hellscript/voice`): Three sections (Threads/LinkedIn/General), each with a text area and save button. Shows "not set" when null.

**HellscriptSamplesPage** (`/hellscript/scriptures`): Category tabs, sample list with title + truncated preview, add/edit/delete actions. "Add Sample" disabled at 5/5 with counter label. Add/edit form has title input (maxLength 200) + text area (no limit).

### New files

- `pages/HellscriptStylePage.tsx`
- `pages/HellscriptSamplesPage.tsx`
- `hooks/useWritingConfig.ts`
- `hooks/useWritingSamples.ts`
- `services/hellscriptWritingConfigApi.ts`

### Modified types

- `HellscriptMaterializedState` — remove `writingSamples`, `styleInstructions`, `audience`, `contentGoal`
- Remove `HellscriptIntentKind` values: `add_writing_sample`, `set_style_instructions`, `set_metadata`

### category_required handling

When `POST /hellscript/impose` returns `action: 'category_required'`, the `HellscriptConversationPage` displays a system message prompting the user to specify the target platform in their next utterance.
