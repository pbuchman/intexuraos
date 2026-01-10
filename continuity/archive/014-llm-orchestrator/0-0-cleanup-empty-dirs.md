# Task 0-0: Cleanup Empty Placeholder Directories

## Objective

Remove empty placeholder directories or properly initialize them with package.json.

## Current State

Empty directories exist:

- `packages/infra-whatsapp/`
- `packages/infra-gemini/`
- `packages/infra-claude/`
- `packages/infra-gpt/`
- `apps/research-agent-service/`

## Actions

1. Remove empty directories (they will be created properly in later tasks)
2. Verify git status is clean

## Commands

```bash
rm -rf packages/infra-whatsapp
rm -rf packages/infra-gemini
rm -rf packages/infra-claude
rm -rf packages/infra-gpt
rm -rf apps/research-agent-service
git status
```

## Verification

- No empty directories in packages/ or apps/
- `npm run ci` still passes

## Acceptance Criteria

- [ ] Empty directories removed
- [ ] `npm run ci` passes
