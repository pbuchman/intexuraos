# Website Suggestions Template

Use this template when presenting website improvement suggestions in Phase 5.

---

## Format

Present EXACTLY 3 suggestions using this format:

```markdown
### Suggestion 1: [TYPE] Title
**What:** Specific action to take
**Why:** Reason this matters for users/business
**Effort:** Low | Medium | High

### Suggestion 2: [TYPE] Title
**What:** Specific action to take
**Why:** Reason this matters for users/business
**Effort:** Low | Medium | High

### Suggestion 3: [TYPE] Title
**What:** Specific action to take
**Why:** Reason this matters for users/business
**Effort:** Low | Medium | High
```

---

## Type Prefixes

| Prefix    | Use When                                      | Example                           |
| --------- | --------------------------------------------- | --------------------------------- |
| [FEATURE] | Adding new section or component               | "Add testimonials section"        |
| [IMPROVE] | Enhancing existing functionality              | "Enhance hero section"            |
| [CONTENT] | Updating text, stats, or media                | "Update AI model count"           |
| [FIX]     | Correcting outdated or incorrect content      | "Fix broken documentation link"   |
| [UX]      | Improving user experience or navigation       | "Improve mobile navigation"       |

---

## Effort Levels

| Level    | Time Estimate  | Characteristics                              |
| -------- | -------------- | -------------------------------------------- |
| **Low**  | < 30 minutes   | Text update, single component, no design     |
| **Medium**| 30 min - 2 hr | Multiple components, new data, minor design  |
| **High** | > 2 hours      | New section, significant design, new assets  |

---

## Selection Rules

When compiling suggestions, ensure:

1. **At least 1 is release-driven** — Directly showcases new release features
2. **At least 1 is Low effort** — Quick win for immediate value
3. **Maximum 1 is High effort** — Scope control

---

## Example Output

```markdown
Based on release v2.1.0, here are 3 website improvements:

### Suggestion 1: [CONTENT] Update RecentUpdatesSection
**What:** Add v2.1.0 release highlights: GLM-4.7-Flash support, WhatsApp reactions, Calendar preview flow
**Why:** Homepage should showcase latest capabilities to convert visitors
**Effort:** Low

### Suggestion 2: [FIX] Update hero statistics
**What:** Change "16 AI Models" to "17 AI Models", update service count badge
**Why:** Outdated stats understate platform capabilities and credibility
**Effort:** Low

### Suggestion 3: [FEATURE] Add approval flow visualization
**What:** Create animated diagram showing WhatsApp message → approval → action execution flow
**Why:** The approval workflow is a key differentiator that's currently not visualized anywhere
**Effort:** Medium
```

---

## Checkpoint Presentation

When presenting to user at checkpoint:

```
Website Improvement Suggestions

Based on this release, here are 3 website improvements:

1. [CONTENT] **Update RecentUpdatesSection**
   What: Add v2.1.0 release highlights
   Why: Homepage should showcase latest capabilities
   Effort: Low

2. [FIX] **Update hero statistics**
   What: Update AI model and service counts
   Why: Outdated stats understate capabilities
   Effort: Low

3. [FEATURE] **Add approval flow visualization**
   What: Create animated diagram of approval workflow
   Why: Key differentiator not currently visualized
   Effort: Medium

Which suggestions should I implement?
```

Options should use `multiSelect: true` to allow selecting multiple.
