# INT-1670 Code Composition Analysis

Generated: 2026-06-16T16:58:39Z
Analyzed commit: `a5a9509750bf8cf03f0b90408b2d68c344de5c97`

This one-time analysis counts tracked text files in the repository and reports both
physical lines and non-blank lines. The headline LOC number uses non-blank lines.
This evidence file was not included in the count.

## Scope

- Source set: `git ls-files`
- Included: tracked text files
- Excluded: dependency directories, build/cache output, IDE metadata, lockfiles,
  generated wiring files, test/build reports, and binary/asset/key material
- Binary files: skipped

## Analysis Method

The source manifest came from `git ls-files -z` at the analyzed commit. Each
remaining file was read as UTF-8 text. Files containing NUL bytes were treated as
binary and skipped. Physical lines count newline-normalized rows; non-blank
lines count rows where `trim()` is not empty.

Exclusion patterns:

- `node_modules/`, `.pnpm/`, `.terraform/`, `.cache/`, `.turbo/`, `.vite/`,
  `.next/`
- `dist/`, `build/`, `coverage/`, `playwright-report/`, `test-results/`,
  `apps/web/dev-dist/`, generated directories
- `*.tsbuildinfo`, `*.log`
- `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`
- `apps/web/src/config.generated.ts`, `ecosystem.generated.cjs`,
  `terraform/environments/dev/service-urls.auto.tfvars.json`,
  `terraform/hetzner-prod/prod.auto.tfvars.json`, `packages/README.md`
- Binary/asset/key extensions: `png`, `jpg`, `jpeg`, `gif`, `webp`, `ico`,
  `pdf`, `zip`, `gz`, `mp4`, `mov`, `woff`, `woff2`, `ttf`, `pem`, `crt`

Language classification used filename overrides for `Dockerfile`, `LICENSE`,
`firebase.json`, and `firestore.rules`; all other files were mapped by extension
where known, with unknown extensions reported by uppercase extension or `Other`.

Code type classification used this precedence:

1. Exclude files matching the exclusion patterns above.
2. Test files.
3. Documentation files.
4. Script files.
5. Production code for all remaining tracked text files.

## Summary

| Metric | Count |
| --- | ---: |
| Files analyzed | 4,671 |
| Physical lines | 1,040,868 |
| Non-blank lines | 880,169 |

## Breakdown by Code Type

| Type | Files | Physical lines | Non-blank lines |
| --- | ---: | ---: | ---: |
| Test | 1,473 | 457,322 | 396,209 |
| Production code | 2,219 | 270,683 | 244,138 |
| Documentation | 762 | 281,321 | 213,037 |
| Script | 217 | 31,542 | 26,785 |

## Breakdown by Language

| Language | Files | Physical lines | Non-blank lines |
| --- | ---: | ---: | ---: |
| TypeScript | 2,785 | 651,700 | 569,949 |
| Markdown | 745 | 270,122 | 202,759 |
| TSX | 296 | 46,114 | 42,206 |
| JavaScript | 191 | 22,173 | 19,422 |
| JSON | 271 | 12,837 | 12,837 |
| HTML | 11 | 11,361 | 10,451 |
| Shell | 74 | 9,609 | 8,000 |
| Terraform | 76 | 8,082 | 6,967 |
| Text | 134 | 2,827 | 2,669 |
| YAML | 23 | 2,081 | 1,720 |
| Dockerfile | 25 | 1,519 | 1,100 |
| PATCH | 3 | 650 | 626 |
| CSS | 2 | 359 | 292 |
| EXAMPLE | 4 | 293 | 248 |
| Config | 1 | 247 | 221 |
| TEMPLATE | 5 | 304 | 207 |
| Firebase Rules | 1 | 154 | 120 |
| LUA | 1 | 113 | 96 |
| Git ignore | 3 | 94 | 78 |
| Other | 13 | 74 | 66 |
| TEST | 1 | 67 | 52 |
| TFTPL | 1 | 25 | 25 |
| XML | 1 | 21 | 21 |
| Docker ignore | 2 | 17 | 17 |
| License | 1 | 22 | 17 |
| TOML | 1 | 3 | 3 |

## Code Type Rules

- Test: `__tests__`, `__mocks__`, `test`, `tests`, `e2e`, `fixtures`,
  `test-fixtures`, `vitest-mocks`, `mock-*`, `*.test.*`, `*.spec.*`,
  Vitest setup/config files, and Playwright config files.
- Documentation: Markdown/MDX files, `docs/`, repository agent/rule docs,
  changelogs, README files, and `LICENSE`.
- Script: automation and support areas such as `scripts/`, `tools/`,
  `cloudbuild/`, `docker/`, `.github/`, `.claude/`, `.codex/`,
  `eslint-rules/`, Dockerfiles, Cloud Build YAML, and shell scripts.
- Production code: all remaining tracked text files after documentation, test,
  and script classification.
