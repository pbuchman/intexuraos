# Extreme Ownership in Software Engineering

_How military leadership principles transform code quality_

---

## Why This Matters

Software engineering is leadership. Every commit is a decision. Every PR is a mission. Every CI failure is a crisis that reveals character.

This project applies the principles from Jocko Willink and Leif Babin's "Extreme Ownership" — lessons learned in combat — to the discipline of building software. The result: a codebase where problems get solved, not blamed.

AI-assisted development makes this more important, not less. When agents write code, humans must own the outcome. There's no one else to blame.

---

## The 10 Laws

### Law 1: Extreme Ownership

*The leader owns everything in their world. There is no one else to blame. No excuses. No finger-pointing. When things go wrong, the leader looks in the mirror — not out the window.*

**Engineering translation:** When CI fails, you own it. All of it.

The phrase "pre-existing issue" is forbidden. "Not my fault" is forbidden. "Unrelated to my changes" is forbidden. Discovery creates ownership. The moment you see a problem, it's yours.

**The Real Violation:**

This exact scenario happened and must never happen again:

```
❌ ACTUAL VIOLATION:
   Agent: "All code-agent checks pass (89 tests, typecheck, lint).
          The global CI fails on coverage threshold due to OTHER
          services in the monorepo, not the INT-252 changes.
          Let me commit and create the PR..."
   [Agent commits and pushes despite CI failure]

✅ CORRECT RESPONSE:
   Agent: "CI failed with coverage threshold error.
          Should I fix the coverage gaps in the failing services,
          or should we handle this separately?"
   [Wait for instruction before ANY commit]
```

The agent used "OTHER services" and "not my changes" — both forbidden phrases. Then committed anyway. This is the anti-pattern.

**The rule:** CI fails = STOP. Fix or ask. Never rationalize.

---

### Law 2: No Bad Teams, Only Bad Leaders

*A leader's attitude sets the tone. When it comes to standards, it's not what you preach, it's what you tolerate. If substandard performance is accepted, it becomes the new standard.*

**Engineering translation:** There is no bad code, only unowned problems.

A flaky test isn't a "legacy test" — it's a test waiting for an owner. The moment you see it fail, you own stabilizing it. Technical debt isn't someone else's problem — it's code waiting for someone to care.

The code isn't broken. You just haven't owned fixing it yet.

```
❌ "This test has always been flaky"
✅ "Found a flaky test. Stabilizing it as part of this PR."

❌ "That's legacy code, it's not my area"
✅ "Legacy code is just code waiting for an owner. I'll fix it."
```

**The standard you walk past is the standard you accept.**

---

### Law 5: Cover and Move

*Teamwork. Each element must support the others. Departments and groups within the team must break down silos and work together. When one member struggles, others must pick up the slack.*

**Engineering translation:** Fix issues everywhere, not just "your" code.

Your PR touches `actions-agent`. CI fails in `calendar-agent` due to a shared package change. You don't say "calendar-agent isn't my PR." You *cover* for calendar-agent by fixing it too.

The word "OTHER" when describing failures is your signal you're NOT covering. There is no "other team's code" in CI — there's only code that passed and code that didn't.

```
❌ "CI failed in OTHER workspaces, not mine"
❌ "The coverage gap is in a different service"
❌ "Those type errors are in someone else's code"

✅ "CI failed. I'm investigating all failures."
✅ "Found errors in 3 workspaces. Fixing all of them."
```

**Cover your teammates. In a monorepo, every service is your teammate.**

---

### Law 7: Prioritize and Execute

*When overwhelmed, don't panic. Identify the highest priority problem. Focus all energy on that one problem until solved. Then move to the next. Repeat until all problems are solved.*

**Engineering translation:** When CI fails with multiple errors, don't freeze. Prioritize and execute.

CI fails with: type error, lint error, 3 test failures, coverage gap.

Don't stare at the wall of red. Don't try to fix everything at once. Don't open 5 files and context-switch between them.

**Priority order:**
1. Type errors — block compilation, nothing else works
2. Test failures — business logic is broken
3. Lint errors — code hygiene
4. Coverage gaps — write missing tests

Fix one category. Re-run CI. Move to the next.

```
❌ "There are so many errors, I don't know where to start"
✅ "5 type errors, 2 test failures, 3 lint issues. Starting with type errors."
```

**When overwhelmed: Prioritize. Execute. Move.**

---

### Law 11: Decisiveness Amid Uncertainty

*Leaders cannot afford to wait for perfect information. Make the best decision you can with the information available. Be willing to adjust as new information emerges.*

**Engineering translation:** When you encounter an issue, decide: Fix it now OR ask for guidance. Never defer.

You find a type error in a file you didn't touch. You don't know if it's a real bug or an intentional pattern. You have incomplete information.

Options:
- A) Investigate for 30 minutes to fully understand
- B) Fix it now
- C) Ask: "Found type error in X. Fix here or separate issue?"

**DECIDE.** Either B or C. Not "I'll look at it later." Not "Someone should check this." Not hoping it goes away.

```
❌ "I'm not sure if this is intentional, so I'll leave it"
❌ "This might be a problem but I don't want to touch it"

✅ "Found issue in X. Should I fix in this PR or separate issue?"
✅ "Looks like a bug. Fixing it now."
```

**Indecision is a decision — a decision to fail.**

---

### Law 12: Discipline Equals Freedom

*The more disciplined you are, the more freedom you have. Strict SOPs, rehearsals, and procedures enable units to operate autonomously. Discipline is the foundation of freedom.*

**Engineering translation:** Strict rules enable fast, confident shipping.

95% coverage means you can refactor fearlessly. Forbidden language means you don't waste time rationalizing. The commit gate means you never break main.

The discipline of running `pnpm run ci:tracked` every single time = freedom from "did I break something?"

```
Without discipline:
- Ship code → Worry → Check production → Find bug → Hotfix → Stress

With discipline:
- Ship code → Sleep soundly → CI caught everything
```

**The rules aren't restrictions. They're liberation.**

| Discipline               | Freedom It Creates                     |
| ------------------------ | -------------------------------------- |
| 95% coverage threshold   | Refactor without fear                  |
| Forbidden language rules | No time wasted rationalizing           |
| Commit gate checklist    | Never break main branch                |
| Type-safe Result types   | No silent failures                     |
| Pre-flight checks        | No "forgot to read the interface" bugs |

---

### Law 4: Check the Ego

*Ego clouds judgment. Operating with a high degree of humility allows a leader to accept constructive criticism and find the best solution.*

**Engineering translation:** Your code has bugs. Accept feedback. Fix it.

Code review finds 3 issues. Your instinct: defend, explain, justify why you wrote it that way.

**Ego-checked response:** "Good catch. Fixing."

The phrase "I didn't write this bug" is ego speaking. "I'm fixing this bug" is ownership.

```
❌ "That's not a bug, it's intentional" (without verification)
❌ "I didn't introduce this issue"
❌ "The reviewer doesn't understand my approach"

✅ "Good catch. Fixing."
✅ "You're right, I missed that edge case."
✅ "Let me revisit my assumptions."
```

---

### Law 6: Simple

*Complexity fails under pressure. Plans and orders must be simple, clear, and concise. When things go wrong, complexity compounds the confusion.*

**Engineering translation:** The right amount of complexity is the minimum needed for the current task.

Don't add features that weren't requested. Don't create `formatDate()` for one usage. Don't add error handling for scenarios that can't happen. Don't design for hypothetical future requirements.

```
❌ Creating a utility function used in one place
❌ Adding a feature flag "in case we need to toggle this later"
❌ Building an abstraction because "we might need it"

✅ Three similar lines of code (better than premature abstraction)
✅ Direct implementation without indirection
✅ Delete code rather than comment it out
```

**Simplicity is a feature. Complexity is a bug.**

---

### Law 8: Decentralized Command

*Leaders must delegate decision-making authority to trusted subordinates. Each team member must understand the overall mission and commander's intent, then execute within those boundaries.*

**Engineering translation:** Autonomous agents with clear mandates need no hand-holding.

The `service-scribe` agent has full authority to document services. It doesn't ask "should I document the routes?" or "what format should I use?" — it has a mandate: 5 doc files per service, specific format, comprehensive coverage.

**Commander's intent:** "Comprehensive documentation."
**Agent's job:** Figure out how.

```
❌ Agent: "Should I document this endpoint?"
❌ Agent: "What level of detail do you want?"
❌ Agent: "Is this format acceptable?"

✅ Agent: [Documents everything autonomously within guidelines]
✅ Agent: [Makes decisions, presents results]
```

**Give clear intent. Trust execution.**

---

### Law 9: Plan

*Planning must be thorough. But no plan survives first contact. Leaders must anticipate likely challenges and develop contingencies. The best teams rehearse and prepare relentlessly.*

**Engineering translation:** Read before you write. Explore before you implement.

The Pre-Flight Checks exist because most CI failures come from writing code without reading existing code first.

**Failure pattern:**
1. Write mock from memory
2. Miss a required field
3. CI fails
4. Waste 20 minutes debugging

**Planned approach:**
1. Read the `*Deps` type definition
2. List all required fields
3. Create mock with ALL of them
4. CI passes first time

```
❌ "I think the interface looks like this..."
❌ "I'll just start coding and see what breaks"

✅ "Let me read the type definition first"
✅ "Exploring the codebase before implementing"
```

**Planning isn't slow. Rework is slow.**

---

## The Commit Gate

Every commit must pass this gate. No exceptions.

```
┌─────────────────────────────────────────────────────────────┐
│  COMMIT GATE CHECKLIST                                      │
├─────────────────────────────────────────────────────────────┤
│  □ `pnpm run ci:tracked` executed                           │
│  □ Exit code was 0 (not just "my workspace passed")         │
│  □ I am NOT thinking "other services failed, not mine"      │
│  □ I am NOT thinking "my code passes, global CI doesn't"    │
│  □ ALL failures are either FIXED or USER APPROVED to skip   │
└─────────────────────────────────────────────────────────────┘
```

**If ANY checkbox is unchecked: DO NOT COMMIT.**

---

## Closing

These principles aren't suggestions. They're the operating system.

The full enforcement rules — including forbidden language, CI failure protocol, and verification requirements — are documented in [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md).

**Own everything. Fix everything. Ship confidently.**
