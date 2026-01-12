# AGENTS.md

This file provides guidance for AI agents (Claude, Copilot, etc.) working on this codebase.

**All agents MUST read and understand `.claude/claude.md` before making changes.**

---

## Welcome Message (REQUIRED)

When starting a new session, all agents MUST clearly state:

> I have read and understood the instructions in `.claude/claude.md` and will follow them throughout this task.

This ensures the agent is aware of all verification requirements, architecture patterns, testing rules, and code quality standards.

---

## Key Instructions from .claude/claude.md

### Verification (MANDATORY)

Before committing changes for any workspace:

1. **Targeted Verification** (per workspace):

   ```bash
   npm run verify:workspace:tracked -- <app-name>
   ```

2. **Full CI** (after all changes):
   ```bash
   npm run ci:tracked            # MUST pass before task completion
   tf fmt -check -recursive      # If terraform changed
   tf validate
   ```

### Critical Rules

- **Test-First Development**: Always write tests BEFORE implementation code
- **Import Rules**: Use `.js` extension for all ES module imports
- **ServiceContainer**: Check existing tests before adding services
- **No Code Comments**: Add comments only for non-obvious logic (no `// Stub external dependencies`)
- **Git Commit Policy**: NEVER push without explicit instruction
- **Coverage**: 95% threshold - NEVER modify vitest.config.ts exclusions

### Architecture

```
apps/<app>/src/
  domain/     → Business logic (no external deps)
  infra/      → Adapters (Firestore, APIs, etc.)
  routes/     → HTTP transport
  services.ts → DI container
```

### Code Quality

- Follow existing patterns (don't invent new ones)
- Audit ALL services for same issue before committing
- Handle errors gracefully with detailed logging
- Use `getErrorMessage()` for error handling

---

## Reference

For complete details, see: [.claude/claude.md](.claude/claude.md)
