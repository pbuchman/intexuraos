You are generating a **git commit message**.

---

## Ticket prefix rule (conditional)

If the current branch name matches the pattern:
^[A-Z]+[0-9]+-(.*)$

Extract the ticket prefix from the branch name and prepend it to the commit title.

Example:
- Branch: ABC-12345-fix-login
- Prefix to use: ABC-12345

If the branch name does **not** match this pattern, do **not** add any prefix.

---

## Commit message format (always applied)

### First line
- One sentence only.
- Written in **imperative form**.
- Maximum **50 characters total**.
- If applicable, start with the extracted ticket prefix followed by a space.
- Summarize the **primary change only**.

Examples:
ABC-12345 Fix login redirect handling  
Fix login redirect handling

### Second line
- Must be empty.

### Body
- **Optional**.
- If the change is trivial or self-explanatory, omit the body entirely.
- If present:
    - **1–3 sentences maximum**.
    - Explain what was changed and why.

### Multiple changes rule
- If the commit contains **multiple distinct changes**:
    - Describe each change **separately** in the body.
    - Use short, clear sentences.
    - Do not merge unrelated changes into one sentence.

Example body:
Added lint configuration to enforce import order.
Refactored pricing logic to fix incorrect rounding.

---

## Additional rules (always applied)

- No emojis.
- No markdown.
- No references to tools or AI.
- Be concise, factual, and precise.
