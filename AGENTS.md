# AGENTS.md

## Purpose

This file is a routing gate, not a duplicate rulebook.

## Authority (Mandatory)

- `.claude/CLAUDE.md` is the single source of truth for project rules.
- If this file and `.claude/CLAUDE.md` ever conflict, follow `.claude/CLAUDE.md`.
- Do not restate or fork rule content here.

## Session Start Gate (Run Every Fresh Session)

Before any analysis, edits, tests, branch actions, or commits, the agent MUST read:

1. `.claude/CLAUDE.md`
2. Every concrete file explicitly required by `.claude/CLAUDE.md`

## Execution Policy

- Treat completion of the Session Start Gate as a hard prerequisite.
- If any referenced file is missing or unreadable, report it immediately and continue with the remaining available required files.
- Keep behavior aligned to `.claude/CLAUDE.md` and any files it explicitly requires for the entire session.

## Change Control

- When project rules change, update `.claude/CLAUDE.md` (and its references), not this file.
- All new observations, conventions, and rules discovered during work must be documented in the `.claude` rule structure (typically `.claude/reference/*.md` and linked from `.claude/CLAUDE.md`), not in `AGENTS.md`.
- Keep this file minimal and stable.
