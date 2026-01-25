# README "What's New" Template

Use this template when generating the "What's New in vX.Y.Z" section for README.md.

---

## Format

```markdown
## What's New in vX.Y.Z

| Feature             | Description                                |
| ------------------- | ------------------------------------------ |
| **Feature Name**    | One-sentence user-facing description       |
| **Another Feature** | Brief explanation of the value it provides |
| **Third Feature**   | What the user can now do                   |
```

---

## Guidelines

### Feature Count

- **Target**: 6-10 features
- **Minimum**: 4 features (for patch releases)
- **Maximum**: 12 features (summarize if more)

### Writing Style

| Do                                       | Don't                                  |
| ---------------------------------------- | -------------------------------------- |
| User-facing language                     | Internal jargon or code terms          |
| Focus on what user can do                | Focus on how it's implemented          |
| Action verbs: "Add", "Enable", "Support" | Passive voice: "Was added", "Has been" |
| Concrete benefits                        | Vague improvements                     |
| Present tense                            | Past tense                             |

### Sorting Order

1. **Breaking changes** (if any) — ALWAYS first
2. **Major new features** — Most impactful
3. **Significant improvements** — Enhanced capabilities
4. **Quality of life** — Smaller but valuable
5. **Technical improvements** — If user-relevant

### Feature Naming

| Good                               | Bad                                     |
| ---------------------------------- | --------------------------------------- |
| "WhatsApp Approval Workflow"       | "Added approval flow to WhatsApp"       |
| "Natural Language Model Selection" | "LLM selection via message parsing"     |
| "Calendar Preview"                 | "Preview calendar events before create" |
| "5-Step Classification"            | "Improved classifier pipeline"          |

### Description Guidelines

- **One sentence only** — No periods within, period at end
- **Start with action** — "Approve", "See", "Specify", "Schedule"
- **Include the benefit** — Why does the user care?
- **Be specific** — Concrete examples over abstract descriptions

---

## Example

### Good Example

```markdown
## What's New in v2.0.0

| Feature                              | Description                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| **WhatsApp Approval Workflow**       | Approve or reject actions via text replies ("yes", "ok", "reject") or emoji reactions (...) |
| **Calendar Preview**                 | See exactly what will be created before approving calendar events                           |
| **Natural Language Model Selection** | Specify models in messages: "research with Claude and GPT"                                  |
| **5-Step Classification**            | URL keyword isolation, explicit intent priority, Polish language support                    |
| **Zod Schema Validation**            | Type-safe LLM response handling with parser + repair pattern                                |
| **GLM-4.7-Flash**                    | New free-tier model for cost-effective classification                                       |
```

### Bad Example

```markdown
## What's New

| Feature    | Description             |
| ---------- | ----------------------- |
| Approval   | Added approval flow     |
| Calendar   | Preview support         |
| Models     | Can use multiple models |
| Classifier | Better classification   |
| Validation | Zod validation          |
| GLM        | New model               |
```

---

## Integration with README

### Location

The "What's New" section appears after the logo/badges header, before "The Problem" section.

### Replacement Pattern

1. Find existing `## What's New in vX.Y.Z` section
2. Replace entire section including header
3. Keep `---` separator below section

### Version Number

Always update the version in the header:

```diff
- ## What's New in v2.0.0
+ ## What's New in v2.1.0
```
