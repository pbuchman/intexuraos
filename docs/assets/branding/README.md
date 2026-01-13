# IntexuraOS Branding Contract

IntexuraOS has a single official branding direction (version 3: tight system framing).

## Rules

- All logos and icons MUST be generated using prompts in the `prompts/` directory.
- Ad-hoc or experimental branding is forbidden.
- Branding assets MUST NOT appear outside `docs/assets/branding/exports/`.
- No branding files are allowed in `apps/`, `packages/`, or repository root.
- Any branding change requires:
  - updating the prompt files
  - regenerating exports
  - updating this documentation

Branding is treated as a repository-level invariant, not a creative playground.

## Directory Structure

```
docs/assets/branding/
├── README.md           # This file
├── prompts/            # Generation prompts (source of truth)
│   ├── logo-primary-dark.prompt.md
│   ├── logo-primary-light.prompt.md
│   ├── icon-dark.prompt.md
│   └── icon-light.prompt.md
└── exports/            # Generated assets only
    ├── primary/        # Full logos with logotype
    └── icon/           # Symbol-only icons
```

## Prompt Files

| File                           | Purpose                     |
| ------------------------------  | ---------------------------  |
| `logo-primary-dark.prompt.md`  | Full logo, dark background  |
| `logo-primary-light.prompt.md` | Full logo, light background |
| `icon-dark.prompt.md`          | Icon only, dark background  |
| `icon-light.prompt.md`         | Icon only, light background |

## Asset Generation Workflow

1. Update prompt file(s) in `prompts/`
2. Use prompt with image generation tool
3. Export result to appropriate `exports/` subdirectory
4. Verify visual consistency across variants
5. Commit all changes together
