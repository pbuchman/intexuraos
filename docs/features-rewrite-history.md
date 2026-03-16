# Features Rewrite History

Audit trail for all `features.md` rewrites produced by the `/features-rewrite` convergence skill.

Each entry records: date, rounds, final scores, convergence outcome, and key corrections applied.

## Scoring Key

- **Score**: 1-10 per critic (see `convergence-criteria.md`)
- **Verdict**: SHIP (ready) or REVISE (issues found)
- **Columns**: PA = Platform Architect, Dev = External Developer, Strat = Product Strategist, EU = End User, Build = First-Time Builder, Comp = Competitor Analyst

---

## 2026-02-22 — First Execution: whatsapp-service (4 rounds)

The first full run of the multi-agent convergence loop. whatsapp-service was the proving ground — the process that validated the approach before it was codified into the `/features-rewrite` skill.

Team: 1 Opus writer + 6 critics (PA on Opus, 5 on Sonnet), coordinated via `TeamCreate` with live writer across rounds.

### Round-by-Round Progression

| Round | PA  | Dev | Strat | EU  | Build | Comp | Avg  | SHIP | Action                  |
| ----- | --- | --- | ----- | --- | ----- | ---- | ---- | ---- | ----------------------- |
| R1    | 7   | 7   | 7     | 6   | 7     | 7    | 6.83 | 0/6  | Full rewrite            |
| R2    | 8   | 8   | 8     | 8   | 8     | 7    | 7.83 | 0/6  | Full rewrite            |
| R3    | 8   | 9   | 9     | 8   | 9     | 8    | 8.50 | 3/6  | Targeted edits          |
| R4    | 9   | 9   | 9.5   | 9   | 9.5   | 9.5  | 9.32 | 6/6  | Done                    |

### Key Learnings (shaped the skill design)

- **PA is the most valuable critic** — caught fabricated "session persistence" claim by reading actual source code. No other critic flagged it.
- **EU catches invisible jargon** — flagged "classification layer", "publishes a notification", "propagates instantly" that all technical critics missed.
- **Writer fabricates capabilities under pressure** — when asked to "strengthen the moat", writer invented features. PA caught these in R2.
- **Competitor Analyst hardest to satisfy** — consistently scored lowest, but sharpened positioning (fragmentation angle > "no new app" angle).
- **4 rounds typical**: R1 baseline (6-7), R2 error fixes (8), R3 gap closing (8.5), R4 polish (9+). Led to the 3-round max in the skill (R4 barely moved scores).
- **Wrong facts survive multiple rounds** — "single phone per user" persisted until PA checked source code and found the array type.

---

## 2026-02-23 — Batch Run (24 services)

All 24 services scored through the full 6-critic panel. Existing drafts presented as-is to critics; only targeted edits applied from REVISE feedback.

| Service                      | PA    | Dev   | Strat | EU    | Build | Comp  | Avg  | SHIP | Outcome         |
| ---------------------------- | ----- | ----- | ----- | ----- | ----- | ----- | ---- | ---- | --------------- |
| whatsapp-service             | 9     | 9     | 9.5   | 9     | 9.5   | 9.5   | 9.25 | 6/6  | Done            |
| actions-agent                | 8 R   | 9     | 9     | 8     | 8     | 9     | 8.50 | 5/6  | Targeted edits  |
| api-docs-hub                 | 8 R   | 9     | 8.5   | 9     | 8.5   | 8     | 8.50 | 5/6  | Targeted edits  |
| app-settings-service         | 9     | 9     | 9     | 9     | 8.5   | 8     | 8.75 | 6/6  | Done            |
| auth-service                 | 8 R   | 9     | 9     | 8.5   | 8     | 9     | 8.58 | 5/6  | Targeted edits  |
| bookmarks-agent              | 9     | 9.1   | 9.1   | 9     | 8.5   | 7 R   | 8.62 | 5/6  | Targeted edits  |
| calendar-agent               | 7 R   | 9     | 9     | 9     | 7 R   | 8     | 8.17 | 4/6  | Targeted edits  |
| chat-agent                   | 9     | 9.1   | 8.5   | 7.5 R | 8     | 6 R   | 8.02 | 4/6  | Targeted edits  |
| claude-worker                | 8 R   | 9     | 9.5   | 9     | 9     | 8.5   | 8.83 | 5/6  | Targeted edits  |
| code-agent                   | 7 R   | 9     | 9     | 9     | 8 R   | 9     | 8.50 | 4/6  | Targeted edits  |
| commands-agent               | 9     | 7 R   | 8     | 7 R   | 7 R   | 7 R   | 7.50 | 2/6  | Targeted edits  |
| data-insights-agent          | 8 R   | 9     | 9     | 8     | 7 R   | 8     | 8.17 | 4/6  | Targeted edits  |
| email-service                | 9     | 9     | 8     | 9     | 8     | 8     | 8.50 | 6/6  | Done            |
| image-service                | 8 R   | 9     | 9     | 9     | 8     | 8     | 8.50 | 5/6  | Targeted edits  |
| linear-agent                 | 8 R   | 9     | 9     | 9     | 9     | 9     | 8.83 | 5/6  | Targeted edits  |
| mobile-notifications-service | 8 R   | 9     | 9     | 8     | 8     | 9     | 8.50 | 5/6  | Targeted edits  |
| notes-agent                  | 8 R   | 9     | 9     | 9     | 8     | 9     | 8.67 | 5/6  | Targeted edits  |
| notion-service               | 9     | 9     | 9     | 9     | 9     | 8     | 8.83 | 6/6  | Done            |
| orchestrator                 | 7 R   | 9     | 9     | 9     | 9     | 9     | 8.67 | 5/6  | Targeted edits  |
| research-agent               | 7 R   | 9     | 9.5   | 9     | 8     | 9     | 8.58 | 5/6  | Targeted edits  |
| sentry-service               | 9     | 9     | 9     | 9     | 8     | 8.5   | 8.75 | 6/6  | Done            |
| todos-agent                  | 8 R   | 9     | 9     | 8     | 8     | 8     | 8.33 | 5/6  | Targeted edits  |
| user-service                 | 8 R   | 9     | 9     | 9     | 8     | 9     | 8.67 | 5/6  | Targeted edits  |
| web-agent                    | 8 R   | 9     | 9     | 9     | 8.5   | 7 R   | 8.42 | 4/6  | Targeted edits  |

**R** = REVISE verdict.

### Key PA Corrections Applied

| Service                      | Correction                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| claude-worker                | "nothing shared" contradicts shared credentials mode; "no tokens through third-party" false for GLM workers routing through api.z.ai                                |
| orchestrator                 | 8GB/4CPU not in Docker config; mid-task messages queued until attempt finishes, not real-time                                                                       |
| code-agent                   | Doesn't transcribe/classify (that's actions-agent/whatsapp-service); PR comments via sendTaskMessage not new tasks; cancel button on start notification not failure |
| calendar-agent               | OAuth via user-service not direct Google sign-in; attendees not in LLM extraction schema; retry uses stored data                                                    |
| research-agent               | Max 5 providers (not 6); attribution repair can fail; platform fallback only covers Gemini + Zai                                                                    |
| linear-agent                 | Corrected label sync direction; enrichment scope clarified                                                                                                          |
| actions-agent                | Classification routes to agents, doesn't execute actions itself                                                                                                     |
| image-service                | Storage backend details corrected                                                                                                                                   |
| data-insights-agent          | Auto-refresh not wired to any route/scheduler — manual refresh only                                                                                                 |
| notes-agent                  | Sync direction and conflict resolution corrected                                                                                                                    |

### Patterns Observed

- **PA consistently lowest scorer** — deep codebase investigation catches factual errors invisible to other critics. Average PA score: 8.17 vs other critics' average: 8.72.
- **Competitor Analyst most variable** — scores ranged from 6 to 9.5, highly dependent on how differentiated the service is.
- **Commands-agent weakest** — lowest SHIP rate (2/6). Truncated prompt issue in critic batch caused unreliable subjective scores; PA confirmed all claims correct.
- **5 services scored 6/6 SHIP with no edits needed**: app-settings-service, email-service, notion-service, sentry-service, whatsapp-service.

---

## 2026-03-16 — v4 Flagship Trio Rewrite

Engineering showcase for recruiters. Three flagship services rewritten with the v4 documentation refresh.

### code-agent

| Round | PA  | Dev | Strat | EU  | Build | Comp | Avg  | SHIP | Action         |
| ----- | --- | --- | ----- | --- | ----- | ---- | ---- | ---- | -------------- |
| R1    | 8R  | 8R  | 8R    | 6R  | 9     | 8R   | 7.83 | 1/6  | Targeted edits |

**Outcome:** Accepted after targeted edits from 5 REVISE critics.

**Targeted edits applied:**
- Defined "pull request" on first use (End User: used 14 times without explanation)
- Replaced "webhook handler swallows exceptions" with plain language (End User: jargon)
- Renamed "Cross-LLM Verification" → "Independent Verification — Two AIs, Two Providers" (End User: opaque heading)
- Added IntexuraOS context to subtitle (External Developer: never introduced)
- Added visceral sentence to Problem section (Product Strategist: emotional punch)
- Softened worker provider list to remove unverifiable specifics (PA: not in technical.md)
- Added "Voice note to pull request" as named Key Benefit (Competitor: buried pipeline)
- Clarified deployment model with concrete examples (External Developer: unclear)

Overview drift: NONE (overview.md restructured in same session)

### orchestrator

| Round | PA  | Dev | Strat | EU  | Build | Comp | Avg  | SHIP | Action         |
| ----- | --- | --- | ----- | --- | ----- | ---- | ---- | ---- | -------------- |
| R1    | 9   | 9   | 9     | 7R  | 9     | 8R   | 8.50 | 4/6  | Targeted edits |

**Outcome:** Accepted after targeted edits from 2 REVISE critics.

**Targeted edits applied:**
- Replaced "HMAC" with plain-language "cryptographically signed" (End User: jargon)
- Simplified container security spec to outcome language (End User: Linux capabilities jargon)
- Elevated sensitive file guard with explicit differentiation framing (Competitor: underplayed strength)

Overview drift: NONE (overview.md restructured in same session)

### claude-worker

| Round | PA  | Dev | Strat | EU  | Build | Comp | Avg  | SHIP | Action         |
| ----- | --- | --- | ----- | --- | ----- | ---- | ---- | ---- | -------------- |
| R1    | 8R  | 9   | 8.5   | 7R  | 8R    | 6R   | 7.75 | 2/6  | Full rewrite   |
| R2    | 9   | 9   | 9     | 8R  | 8     | 8    | 8.50 | 5/6  | Targeted edits |

**Outcome:** Accepted after R2 targeted edits from End User.

**Key PA corrections (R1):**
- "error tracking" is not a Claude Code plugin — the 6th plugin is "superpowers". Sentry is an MCP server.
- "memory allocation" isolation claim removed — no Docker-level memory limits are set
- 24-hour auto-removal claim made precise — actual cleanup is periodic garbage collection

**R2 improvements:**
- "Recovers Instead of Restarting" promoted to capability #1 (Competitor: was buried)
- "Runs on Your Infrastructure" elevated with competitor naming (Competitor: moat buried)
- Separation rationale expanded with 3 concrete benefits (Builder: architectural WHY)
- Jargon reduced throughout (End User)
- "Security model does not depend on the agent following rules" framing added (Competitor)

Overview drift: NONE (overview.md restructured in same session)
