# Writing Rules

Rules for features.md prose quality. Inlined into the writer prompt.

## Voice

New York Times feature article style:

- Narrative-driven, user-facing, functional
- Second person ("you") for the reader
- Present tense for capabilities, past tense for problems
- Concrete examples over abstract descriptions
- Show outcomes, not implementation

## Structure Template

Every features.md follows this structure:

```
# {Service Display Name}

{One-sentence subtitle: what this service is and its role in IntexuraOS.}

## The Problem

{2-3 paragraphs. Paint a vivid picture of the pain point this service solves.
Use specific scenarios. Make the reader feel the friction.}

## Use Case: {Descriptive Title}

{Who this is built for — one sentence.}

{Narrative walkthrough of a realistic scenario. Numbered steps showing
the service in action. Each step should feel natural, not technical.}

## How It Helps

### {Capability 1 — Verb Phrase}

{2-3 paragraphs explaining the capability. Lead with what the user
experiences, not how it works. Include a bold **Example:** paragraph.}

### {Capability 2 — Verb Phrase}

{Same pattern. Each subsection covers one major capability.}

{Repeat for 3-5 capabilities}

## Getting Connected / Getting Started

{Brief explanation of how a user starts using this service.
One short paragraph. No technical setup details.}

## Key Benefits

{Bulleted list, 4-6 items. Each starts with a bold label and em dash.}

- **Label** — One sentence describing the benefit

## Limitations

{Bulleted list of honest limitations. Each starts with a bold label and em dash.
Be specific about what does NOT work or is constrained.}

---

_Part of [IntexuraOS](../overview.md) — {Tagline connecting to the service's role.}_
```

## Em Dash Convention

Use em dashes ( — ) with spaces on both sides for parenthetical asides and benefit labels. Never use `--` or `---` inline.

## Banned Words and Phrases

These words signal technical writing, not feature writing. Replace or remove them:

| Banned           | Why                         | Replace With                      |
| ---------------- | --------------------------- | --------------------------------- |
| leverage         | Corporate jargon            | use, rely on, build on            |
| utilize          | Same                        | use                               |
| facilitate       | Vague                       | enable, allow, handle             |
| robust           | Meaningless without context | (describe what makes it strong)   |
| seamless         | Overused, unprovable        | smooth, invisible, automatic      |
| cutting-edge     | Marketing cliché            | (describe what's actually new)    |
| state-of-the-art | Same                        | (describe specifically)           |
| ensure           | Often hides "we hope"       | verify, confirm, guarantee        |
| paradigm         | Academic jargon             | approach, pattern, model          |
| synergy          | Corporate cliché            | combination, integration          |
| empower          | Vague empowerment-washing   | let, enable, give                 |
| scalable         | Technical jargon            | grows with you, handles more      |
| ecosystem        | Overused                    | system, platform                  |
| next-generation  | Meaningless                 | (describe the actual improvement) |
| best-in-class    | Unprovable claim            | (describe specific advantage)     |

## Anti-Patterns

1. **Feature listing** — "The service supports X, Y, and Z" reads like a spec sheet. Instead, show the feature in action through a scenario.
2. **Implementation leaking** — "Uses Firestore for storage" belongs in technical.md. Features.md says "your data is always available."
3. **Unverifiable claims** — "Handles fifty message types" must be provable from technical.md or route files. If the exact number is uncertain, use "dozens" or describe the range.
4. **Passive voice** — "Messages are processed by the agent" becomes "The agent processes your messages."
5. **Jargon without context** — If a technical term must appear, explain it immediately in plain language.
6. **Vague benefits** — "Improves productivity" means nothing. Describe the specific time/effort saved.
