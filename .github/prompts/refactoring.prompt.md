# Code Smell Detection and Fix

> **Canonical location:** `.claude/commands/refactoring.md`
>
> This file is a reference pointer. The full prompt is maintained in the Claude folder
> to keep prompts consistent across tools (Copilot, Claude Code, etc.).

See `.claude/commands/refactoring.md` for the complete prompt.

## Quick Reference

**Goal:** Detect code smells, prioritize by impact, fix the single most important one.

**Prerequisites:** Read `.claude/CLAUDE.md` first for known patterns and architecture rules.

**Phases:**

1. Scan for smells (P0-P9 priority levels)
2. Print prioritized list (top 10)
3. Justify and fix top smell
4. Output report

**Key Rule:** Fix one smell per pass, update CLAUDE.md for new patterns.
