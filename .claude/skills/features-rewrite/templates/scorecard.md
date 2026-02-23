# Scorecard Format

Every critic must return their evaluation in this exact format.

## Template

```
## {{CRITIC_ROLE}} Review — {{SERVICE_NAME}}

**Score:** N/10
**Verdict:** SHIP | REVISE

### Strengths
- {What works well — 2-4 bullet points}

### Issues
{Only if REVISE. Each issue includes a fix direction.}

1. **{Issue title}** — {Specific problem description}
   - *Fix:* {Concrete suggestion for what to change}

2. **{Issue title}** — {Specific problem description}
   - *Fix:* {Concrete suggestion for what to change}
```

## Rules

- **Score** must be an integer from 1-10
- **Verdict** must be exactly `SHIP` or `REVISE` — no other values
- **Strengths** are always included, even for REVISE verdicts
- **Issues** are only included for REVISE verdicts
- Each issue MUST include a `Fix:` direction — "this is bad" without a suggestion is not actionable
- Maximum 5 issues per review — prioritize the most impactful
- Do not suggest changes that contradict the owner's vision
- Do not suggest adding technical implementation details — those belong in technical.md
