# Document Code Patterns

You are investigating code patterns and smells discovered during this conversation.

---

## Prerequisites

**Read these files first:**

- `.github/copilot-instructions.md` — contains the "Code Smells (Fix & Document)" section

---

## Task

1. **Review the conversation** for any code issues that were:
  - Flagged by TypeScript (`tsc`)
  - Flagged by ESLint (`npm run lint`)
  - Flagged by IDE inspections/warnings
  - Discovered as runtime bugs
  - Identified as anti-patterns during code review

2. **For each pattern found**, check if it's already documented in `.github/copilot-instructions.md` under "Code
   Smells (Fix & Document)".

3. **If NOT documented**, add it following this format:

```markdown
**Pattern name** — brief description:

\`\`\`ts-example
// ❌ Anti-pattern
<bad code example>

// ✅ Correct pattern
<good code example>
\`\`\`
```

4. **If the pattern can be enforced via ESLint**, also:
  - Add the rule to `eslint.config.js`
  - Document it in the "Code Rules" table in copilot-instructions.md

---

## Verification

After documenting:

1. Run `npm run format` to fix formatting
2. Run `npm run lint` to verify no new errors
3. Run `npm run ci` to ensure everything passes

---

## Output

Summarize what was documented:

| Pattern | Source                | Added to Instructions | ESLint Rule Added |
|---------|-----------------------|-----------------------|-------------------|
| ...     | IDE/TS/ESLint/Runtime | Yes/No                | Yes/No/N/A        |
