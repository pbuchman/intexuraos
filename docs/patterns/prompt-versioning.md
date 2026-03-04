# Prompt Versioning

All `PromptBuilder` prompts MUST include a `version` field following semantic versioning. This enables traceability, regression debugging, and correlation of behavior changes to specific prompt versions.

## Why Version Prompts

Prompts are code that shapes LLM behavior. When a prompt changes, the system's behavior changes — but without versioning, these changes are only visible through git history. Prompt versioning provides:

- **Traceability**: Know which prompt version produced a given output
- **Regression debugging**: When behavior changes, check if a prompt version was bumped
- **Change communication**: Semver conveys the magnitude of a change at a glance

## Semver Semantics for Prompts

| Change Type | Version Bump | Examples                                           |
| ----------- | ------------ | -------------------------------------------------- |
| **MAJOR**   | X.0.0        | Inverted code/linear default in command classifier |
|             |              | Added/removed a classification category            |
|             |              | Changed output format (JSON schema change)         |
| **MINOR**   | x.Y.0        | Added Polish language examples to classifier       |
|             |              | Added new edge case handling                       |
|             |              | Refined instructions for better accuracy           |
| **PATCH**   | x.y.Z        | Fixed typo in calendar extraction prompt           |
|             |              | Formatting improvements                            |
|             |              | Comment clarifications                             |

## How to Bump

Edit the `version` field in the prompt's `PromptBuilder` object:

```typescript
export const commandClassifierPrompt: PromptBuilder<...> = {
  name: 'command-classification',
  description: 'Classifies user messages into command categories',
  version: '2.0.0', // Bumped from 1.0.0 — inverted code/linear default
  build(input, deps) { ... },
};
```

CI catches forgotten bumps — if prompt content changes but the version stays the same, the build fails.

## Where Versions Live

Each `PromptBuilder` object has a `version` field defined in the TypeScript interface:

```typescript
export interface PromptBuilder<TInput, TDeps extends PromptDeps = PromptDeps> {
  readonly name: string;
  readonly description: string;
  readonly version: string; // MAJOR.MINOR.PATCH
  build(input: TInput, deps?: TDeps): string;
}
```

Prompt files are located in:

- `packages/llm-prompts/src/` — shared prompts used across services
- `apps/*/src/` — service-specific prompts
- `workers/*/src/` — worker-specific prompts (e.g., orchestrator system prompts)

## Enforcement

Two CI checks in `scripts/verify-prompt-versions.mjs`:

**Check A — Version field exists and is valid semver:**

- Scans all files containing `PromptBuilder` typed exports
- Verifies each has a `version` field matching `MAJOR.MINOR.PATCH`

**Check B — Version bumped when content changed:**

- Compares prompt files against `origin/development`
- If prompt content changed (excluding the version line) but the version stayed the same, CI fails
- Skipped gracefully when running locally without remote context

```bash
pnpm run verify:prompt-versions
```

## Out of Scope

Bare `build*Prompt()` functions (not using `PromptBuilder`) are not versioned. These are typically repair/context prompts with simple, stable templates. If a bare function controls significant agent behavior, it should be converted to the `PromptBuilder` pattern.
