# Continuity Ledger — 030-synthesis-source-attribution

## Goal

Add deterministic source attribution to synthesis output so users can see which sources actually contributed to which sections.

## Success Criteria

1. Each synthesis section ends with `Attribution: Primary=S1; Secondary=U1; Constraints=; UNK=false`
2. Code-generated breakdown appended showing scorecard and per-source usage
3. `attributionStatus` stored in Firestore (`complete` | `incomplete` | `repaired`)
4. No hallucinated attributions—breakdown is derived strictly from parsed markers

---

## Status

### Done

(none yet)

### Now

- [ ] 1-0-attribution-types.md

### Next

- [ ] 1-1-attribution-parsing.md
- [ ] 1-2-section-parsing.md
- [ ] 1-3-validation.md
- [ ] 1-4-breakdown-generator.md
- [ ] 1-5-attribution-tests.md
- [ ] 2-0-prompt-source-ids.md
- [ ] 2-1-prompt-inject-rules.md
- [ ] 2-2-prompt-tests.md
- [ ] 3-0-repair-usecase.md
- [ ] 3-1-post-processing.md
- [ ] 3-2-firestore-field.md
- [ ] 4-0-integration-test.md
- [ ] 4-1-final-verification.md

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Store `attributionStatus` as Firestore field | User chose this over JSON wrapper |
| Use GeminiAdapter for repair | Reuse existing synthesizer |
| Append breakdown only (no structured storage) | Simpler, matches user preference |
| Non-`##` heading for injected sections | Avoids parser confusion if model echoes prompt |

---

## Open Questions

(none currently)

---

## Blockers

(none currently)
