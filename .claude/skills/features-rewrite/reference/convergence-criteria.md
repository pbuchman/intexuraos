# Convergence Criteria

Decision rules for when to stop iterating.

## Scoring Scale

| Score | Meaning      | Implication                         |
| ----- | ------------ | ----------------------------------- |
| 9-10  | Exceptional  | Ship immediately                    |
| 7-8   | Good         | Minor issues, likely one more pass  |
| 5-6   | Needs work   | Significant gaps, requires revision |
| 3-4   | Poor         | Fundamental problems, full rewrite  |
| 1-2   | Unacceptable | Misses the brief entirely           |

## Critic Verdicts

Each critic returns one of:

- **SHIP** — Ready to publish as-is (may include minor suggestions)
- **REVISE** — Specific issues must be addressed before shipping

## Decision Matrix

After collecting all 6 scorecards:

| Condition                   | Action                     | Next Phase              |
| --------------------------- | -------------------------- | ----------------------- |
| 6/6 SHIP                    | Done                       | Phase 6 (Present Final) |
| Mixed verdicts, avg >= 6.5  | Targeted edits only        | Phase 5 (Edit Pass)     |
| 0/6 SHIP or avg < 6.5       | Full rewrite with feedback | Phase 2 (new round)     |
| Round 3 reached (any score) | Polish and present         | Phase 6 (Present Final) |

## Feedback Consolidation (for R2+)

When feeding critic feedback back to the writer, consolidate and prioritize:

### Priority Tiers

1. **Critical** — Factual errors, fabricated capabilities, wrong claims (PA typically catches these)
2. **High-Impact** — Missing key story elements, wrong emphasis, structural problems
3. **Structural** — Section ordering, flow issues, missing transitions
4. **Competitive** — Positioning gaps, moat understatement, differentiation missed
5. **Nice-to-Have** — Word choice, minor phrasing, polish

### Consolidation Rules

- Merge overlapping feedback from multiple critics into one item
- If critics contradict each other, flag both positions for the writer
- Include the critic role with each feedback item so the writer understands the perspective
- For targeted edits (Phase 5), only include REVISE feedback — skip SHIP critics' suggestions
- Maximum 10 feedback items per round — prioritize ruthlessly

## Maximum Rounds

**Hard limit: 3 rounds.**

Rationale from 24 service rewrites:

- R1 catches 80% of issues (baseline draft)
- R2 catches 95% (error fixes + gap filling)
- R3 is polish only — diminishing returns beyond this
- The whatsapp-service took 4 rounds but the final round barely moved scores

After Round 3, present the best version to the user regardless of scores.
