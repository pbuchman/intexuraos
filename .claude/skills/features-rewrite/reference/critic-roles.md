# Critic Roles

6 critic personas evaluate each draft from different perspectives.

## Role Assignments

| #   | Role                    | Model  | Primary Axis                   | Rationale                                                                                 |
| --- | ----------------------- | ------ | ------------------------------ | ----------------------------------------------------------------------------------------- |
| 1   | Platform Architect (PA) | Opus   | Factual accuracy               | Deep cross-referencing against technical.md and route files requires Opus-level reasoning |
| 2   | External Developer      | Sonnet | Zero-context comprehensibility | Evaluates clarity from fresh perspective — Sonnet's "naive" reading is an asset           |
| 3   | Product Strategist      | Sonnet | Value proposition              | Subjective evaluation of messaging and positioning                                        |
| 4   | End User                | Sonnet | Non-technical accessibility    | Catches jargon that all technical critics miss — proven most valuable for readability     |
| 5   | First-Time Builder      | Sonnet | Architecture clarity           | Evaluates whether the doc inspires and educates about system design                       |
| 6   | Competitor Analyst      | Sonnet | Competitive positioning        | Hardest to satisfy — consistently scores lowest but sharpens differentiation              |

## Why PA Gets Opus

The Platform Architect is the only critic that performs **factual verification** — reading technical.md to check whether claimed capabilities actually exist. This requires:

- Cross-referencing specific claims against documentation
- Detecting fabricated features (writers sometimes invent capabilities when asked to strengthen positioning)
- Verifying numbers and specifics

All other critics evaluate **subjective qualities** (clarity, tone, positioning) where Sonnet performs equally well at lower cost.

## Known Critic Behaviors (from 24 rewrites)

- **PA** is the most valuable critic — catches fabricated capabilities that all others miss
- **End User** catches jargon invisible to technical readers ("classification layer", "publishes a notification")
- **Competitor Analyst** consistently scores lowest — hardest to satisfy, but feedback sharpens the moat
- **External Developer** is most likely to flag missing context for unfamiliar readers
- **Product Strategist** focuses on whether the "story" is compelling and the value proposition is clear
- **First-Time Builder** evaluates whether someone new to the system would understand the architecture from features.md alone
