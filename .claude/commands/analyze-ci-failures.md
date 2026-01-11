# Analyze CI Failures Skill

You are executing a CI failures analysis session to improve LLM instructions based on historical errors.

## Phase 1: Check Data Availability

Check if there's enough data to analyze:

```bash
wc -l .claude/ci-failures/*.jsonl 2>/dev/null || echo "No data"
```

- If **< 30 total lines**: Inform user there's not enough data yet. Suggest waiting for more CI runs.
- If **>= 30 lines**: Proceed to Phase 2

---

## Phase 2: Analyze Error Patterns

Run this analysis to identify top error patterns:

```bash
cat .claude/ci-failures/*.jsonl | jq -s '
  [.[] | select(.passed == false) | .failures[]] |
  group_by(.code) |
  map({
    code: .[0].code,
    type: .[0].type,
    count: length,
    example: .[0].message
  }) |
  sort_by(-.count) |
  .[:10]
'
```

Also get category breakdown:

```bash
cat .claude/ci-failures/*.jsonl | jq -s '
  [.[] | select(.passed == false) | .failures[] | .type] |
  group_by(.) |
  map({type: .[0], count: length}) |
  sort_by(-.count)
'
```

---

## Phase 3: Present Findings to User

Summarize:

1. Total CI runs analyzed
2. Top 5 error codes with counts and example messages
3. Category breakdown (typecheck vs lint vs coverage vs test)

Ask user: "Which patterns should I add to CLAUDE.md? (default: top 4)"

---

## Phase 4: Update CLAUDE.md

Read current "Common LLM Mistakes" section in `.claude/CLAUDE.md`.

For each selected pattern:

1. Create concise example showing wrong vs right approach
2. Add or update entry in "Common LLM Mistakes" section

**Format for each pattern:**

````markdown
### N. [Short Title] — [Key Rule]

```typescript
// X [wrong code]
// V [correct code]
```
````

````

Keep examples minimal (2-4 lines max). Focus on actionable fix, not explanation.

---

## Phase 5: Update Changelog

Add entry to `.claude/ci-failures/README.md` under `## Changelog`:

```markdown
### YYYY-MM-DD — [Title]

**Data analyzed:** X CI runs across Y branch files

**Top errors identified:**
| Error | Count | Category |
|-------|-------|----------|
| ... | ... | ... |

**Actions taken:**
1. [What was added/updated in CLAUDE.md]

**Result:** [Brief summary]
````

---

## Phase 6: Clear History

After user confirms changes are good:

```bash
rm .claude/ci-failures/*.jsonl
```

Inform user: "History cleared. Fresh data collection starts now."

---

## Important Notes

- **Focus on actionable patterns** — Skip generic errors, prioritize ones with clear fixes
- **Keep examples minimal** — LLM should understand at a glance
- **Don't duplicate** — Check if pattern already exists in CLAUDE.md before adding
- **Preserve existing content** — Update, don't replace the entire section
