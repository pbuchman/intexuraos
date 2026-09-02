# Prompt Versioning

All LLM prompts that shape model behavior MUST be expressed as a `PromptBuilder<>` object with a semantic-versioned `version` field. CI enforces this — see `scripts/verify-prompt-versions.mjs`.

## Why Version Prompts

Prompts are code that shapes LLM behavior. When a prompt changes, the system's behavior changes — but without versioning, these changes are only visible through git history. Prompt versioning provides:

- **Traceability**: know which prompt version produced a given output
- **Regression debugging**: when behavior changes, check if a prompt version was bumped
- **Change communication**: semver conveys the magnitude of a change at a glance

## The Pattern

```typescript
export const myPrompt: PromptBuilder<MyInput, MyDeps> = {
  name: 'my-prompt',
  description: 'What this prompt does',
  version: '1.0.0',
  build(input, deps) {
    return `…rendered prompt…`;
  },
};
```

The `PromptBuilder<>` interface (defined in `@intexuraos/llm-contract`) has a required `version` field of the form `MAJOR.MINOR.PATCH`. CI rejects missing or non-semver values.

## Bump Rules

When you edit a prompt, bump the version according to the contract enforced by `scripts/verify-prompt-versions.mjs`:

| Change                                                  | Bump  | Examples                                                      |
| ------------------------------------------------------- | ----- | ------------------------------------------------------------- |
| Behavior change, schema change, removed/added category  | MAJOR | Inverted code/linear default; switched to JSON output         |
| New examples, refined wording, added edge case          | MINOR | Added Polish examples; clarified ambiguous phrasing           |
| Typo fix, comment-only edit, formatting                 | PATCH | Fixed typo in heading; added trailing newline                 |

CI Check B (`scripts/verify-prompt-versions.mjs`) compares prompt files against `origin/development` and fails if file content (excluding the version line) changed without a version bump.

## Plain `buildXxxPrompt` Functions Are NOT Allowed

`scripts/verify-prompt-versions.mjs` Check C scans every `.ts` source file under `packages/llm-prompts/src`, `apps/`, and `workers/` for plain top-level builder exports of the form:

```typescript
export function buildSomethingPrompt(/* … */): string { /* … */ }
```

Any such function is a violation unless the file carries an exemption marker (see below). The remediation is to convert it to a `PromptBuilder<>` object.

### Why no exceptions by default

A plain function has no `version`, no `name`, no `description` — so it cannot participate in observability, evaluation, or change auditing. Bare templates also tend to drift away from shared utilities (e.g. exclusion handling, deps injection) that the `PromptBuilder` infrastructure provides for free.

### When to exempt

Only legitimate cases. The typical examples:

- **Test fixtures** that build a synthetic prompt string for assertion purposes — they aren't shipped to a real LLM.
- **In-progress migrations** with a tracking issue (use the migration marker, see below).

If you are unsure, the answer is "convert it to a `PromptBuilder`".

### Exemption syntax

Add a single comment line anywhere in the file (convention: at the very top, above imports):

```typescript
// prompt-version-exempt: <reason>
```

The reason must be a short human-readable phrase. Examples:

```typescript
// prompt-version-exempt: test fixture only, never sent to a real LLM
// prompt-version-exempt: pending migration to PromptBuilder (INT-1533 Task 2)
```

The verifier matches the regex `\/\/\s*prompt-version-exempt:` — case sensitive, exactly one comment marker per file is sufficient.

## Where Prompt Files Live

- `packages/llm-prompts/src/` — shared prompts used across services
- `apps/*/src/` — service-specific prompts
- `workers/*/src/` — worker-specific prompts (e.g. orchestrator system prompts)

The verifier scans all three roots.

## Enforcement

```bash
pnpm run verify:prompt-versions
# or directly:
node scripts/verify-prompt-versions.mjs
```

The script runs three checks:

- **Check A** — every `PromptBuilder<>` typed export has a valid `MAJOR.MINOR.PATCH` `version` field.
- **Check B** — when prompt-file content changes vs. `origin/development`, the version is bumped (skipped gracefully when no remote is available).
- **Check C** — no plain `export function buildXxxPrompt(` exists outside files with an exemption marker.

The script exits non-zero on any violation. It is wired into `pnpm run ci:tracked`.

## Programmatic Use

The script also exports `analyzeFile(path, content)` for unit testing:

```typescript
import { analyzeFile } from '../verify-prompt-versions.mjs';

const { errors } = analyzeFile('foo.ts', '/* … */');
// errors[0].kind === 'unversioned-plain-builder' | 'missing-version' | 'invalid-version'
```
