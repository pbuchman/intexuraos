# Research Agent

AI answers you can actually cross-reference.

## The Problem

You ask an AI a question and get a confident answer. You ask a different AI the same question and get a different confident answer. One says the study was published in 2019, the other says 2021. One attributes a policy shift to economic pressure, the other to regulatory change. Both sound authoritative. Neither mentions the other possibility exists.

The people who bother to check — consultants vetting a market claim, researchers surveying a new field, founders making a bet on a trend — routinely find these contradictions. A date one model states as fact, another omits entirely. A causal relationship one model treats as settled, another qualifies heavily. Sources one model cites that the others never surface. These disagreements are not noise. They are the most valuable part of any research, because they tell you where certainty ends and judgment begins.

But finding them by hand means copying your question into multiple tools, waiting for each response, reading them side by side, and mentally tracking where they diverge. It takes longer than the research itself. So most people skip it and trust one model's answer — never knowing what they missed.

## Use Case: Evaluating a Remote Work Policy

You are an HR director finalizing your company's position on permanent remote work. The executive team wants evidence, not opinions.

1. You type your question into IntexuraOS: "What does current research say about the long-term effects of fully remote work on employee productivity, mental health, and retention?" You attach two internal survey reports and a recent industry whitepaper — three of the five source slots, totaling well under the 60,000-character limit (about 40 pages of text) per attachment.

2. You mention you want "Claude, Gemini, and Perplexity — plus whatever rounds it out." The system interprets your natural language and selects Claude Sonnet, Gemini Pro, and Perplexity Deep Research, adding two more models to reach five providers. If the interpretation seems off, you can adjust before anything runs.

3. Before any model is queried, the system refines your question. It identifies the domain (workplace psychology, HR policy), sets a time scope (last five years), infers you want a standard-depth analysis rather than a quick summary, generates sub-questions about productivity metrics and attrition drivers, and builds a research plan. You see a draft: the refined prompt, the selected models, your attached sources. Nothing happens until you approve.

4. You approve. All five models receive the same structured plan and your attached materials simultaneously. Each works independently — Perplexity's deep research model runs actual web searches while generating its answer, pulling in sources the other models cannot access. Claude draws on its training data with different emphasis. Gemini surfaces a meta-analysis the others miss. This mix matters — when a web-grounded model and a training-data model disagree, the conflict tells you something different than when two training-data models disagree.

5. One model fails partway through — a timeout, an API hiccup. The system does not discard the other four. It flags the failure and asks: proceed with what completed, retry the failed model, or cancel? You choose to proceed.

6. The system synthesizes. It does not simply concatenate. It runs a structured conflict analysis — topic by topic, naming which models reached which conclusions, rating each disagreement by severity. Minor discrepancies (a date off by one year) are distinguished from major contradictions (one model says remote work reduces burnout, another says it increases it). The synthesis weaves agreement and disagreement together, with every claim attributed to its source model.

7. You open each model's original report. Claude's full response with its citations. Gemini's analysis with the meta-analysis it found. Perplexity's web-sourced findings. You can trace any claim in the synthesis back to the model that made it and the sources that model cited.

8. Satisfied, you share the research as a public page — the system generates a cover image and a clean URL. You also export to Notion: the synthesis becomes the main page, each model's full report becomes a child page beneath it, complete with sources. A WhatsApp notification confirms the whole process is done (if you have connected WhatsApp to your account).

9. Two weeks later, a new study drops. You enhance the completed research by adding the new study as context material. The system re-synthesizes, folding the new perspective into the existing work without re-querying the models that already completed.

## How It Helps

### See Where the Models Disagree

Most tools that query multiple AI models hand you a blended summary. The contradictions vanish into smooth prose. Research Agent does the opposite. After all models respond, it runs a separate analytical pass — comparing conclusions topic by topic, naming which models are involved, and rating each disagreement by severity. A minor date discrepancy looks different from a fundamental dispute about whether a treatment works or a policy backfires.

Because every model received the same structured research plan and the same attached materials, their responses are directly comparable. The conflict analysis is not comparing apples to oranges — it is comparing five answers to the same carefully framed question.

**Example:** You research whether a specific drug interaction is clinically significant. Three models say yes with strong evidence. One says the evidence is mixed. One says no. The synthesis flags this as a high-severity conflict, names the dissenting models, and presents the specific claims side by side. You do not get a reassuring average — you get the full disagreement, attributed and rated.

### Refine Your Question Before You Spend

Your question does not go to the models unchanged. The system analyzes it and constructs a research plan: the subject domain, key sub-questions, preferred source types, relevant time window, geographic scope, and answer style. It infers whether you need a quick comparison or a deep audit. It flags potential red flags or safety considerations. Each model receives this structured context alongside a sharpened version of your original question.

Before your question even reaches the planning stage, the system checks it for quality. Vague, ambiguous, or under-specified prompts are flagged, and the system offers an improved version that is more likely to produce focused, comparable results. The improvement preserves the original language — a Polish question returns a Polish improvement — and the system rejects its own improvements if they contain structural issues like multiple options, unwanted prefixes, or explanatory text.

This matters because comparable inputs produce comparable outputs. When five models all interpret a vague question differently, the resulting conflict analysis is noise. When they all receive the same precise framing, disagreements reflect genuine differences in evidence or reasoning — not differences in interpretation.

**Example:** You type "Is intermittent fasting good for you?" The system infers a health domain, sets a five-year time scope, generates sub-questions about metabolic effects, cardiovascular outcomes, and contraindications, and notes that safety information and red flags are relevant. Each model gets this structured plan instead of your six-word question. The responses come back focused and directly comparable.

### Trace Every Claim to Its Source

The synthesis is not a black box. Every claim in the combined report is attributed to the model or models that made it. And each model's original report — with its full reasoning, citations, and sources — is available as a separate document. You can follow any thread from the synthesis down to a specific model's response and from there to the external sources that model cited.

The synthesis is checked for citation completeness before you see it. If any attributions are missing or incomplete, the system attempts to repair them automatically. Most of the time, the repair succeeds — so every section of the final report traces back to the model reports it drew from.

**Example:** The synthesis states that three models agree on a 15% productivity increase for remote workers, citing overlapping sources. You open Gemini's individual report and find it referenced a 2024 meta-analysis the others did not. You open Perplexity's report and see its web search surfaced a contradicting 2025 study. The synthesis flagged the contradiction; the individual reports let you evaluate the evidence yourself.

### Bring Your Own Context

Attach up to five documents — articles, internal reports, previous research, raw notes — each up to 60,000 characters (roughly 40 pages of text). Every model receives your materials alongside the research plan. Your existing knowledge shapes the research from the start, rather than being something you reconcile with the results after the fact.

**Example:** You are researching competitor pricing strategies. You attach your company's current pricing sheet, two competitor teardowns from your strategy team, and a recent analyst report. All five models factor in your specific context, so their responses address your competitive position directly rather than speaking in generalities.

### Choose Models in Plain Language

Say "use Claude and Gemini" or "use the two strongest" or "add Perplexity for web search." The system extracts your preferences and selects specific models. If the extraction fails or you do not specify, the draft presents the selection for you to adjust manually. One model per provider, up to five providers — you are paying for five distinct perspectives, not five versions of the same answer.

Perplexity's models are worth knowing about specifically: they perform live web searches while generating answers, returning more current information than models limited to training data. They take longer, but surface sources the others cannot reach — and when a web-grounded result contradicts a training-data result, that disagreement carries different weight than two closed models disagreeing with each other.

**Example:** You say "use the deep research models." The system selects Perplexity Deep Research, OpenAI's o4-mini deep research, and fills the remaining slots with strong general models. The draft shows exactly what was chosen. You swap one out and approve.

### Share, Export, and Extend

Completed research becomes a shareable artifact. The system generates a cover image and a public URL with a clean slug. Unsharing removes the page and deletes the cover image — nothing lingers. Research also exports to Notion: a main page with the synthesis and sources, child pages for each model's full report. Large exports are handled automatically regardless of length. Re-exporting the same research is blocked to prevent duplicates.

After completion, research is not frozen. You can enhance it — add models that were not in the original run or attach new context material. The system reuses your existing model reports and queries only the new additions, so you pay only for the new models. It then re-synthesizes, integrating fresh perspectives into the existing work. The cost display separates what you already paid from what the enhancement added.

**Example:** You share a competitive analysis with your board. A week later, a major competitor announces a pivot. You enhance the research with the announcement as new context and add a Perplexity model for live web coverage. The updated synthesis reflects the new reality. You reshare the page — same URL, updated content.

## Getting Started

Start a new research from the IntexuraOS web app. Type your question, optionally attach source materials, and indicate which models you want — or let the system choose. Review the draft, approve it, and wait for results. A WhatsApp message notifies you when the synthesis is ready. You do not need your own API keys to start — the platform provides fallback access to a subset of models, so you can run your first research immediately and configure additional providers later.

## Key Benefits

- **Structured conflict detection** — Disagreements identified topic by topic, rated by severity, attributed to specific models — not buried in a blended summary
- **Review before you spend** — The draft step shows you the refined prompt, selected models, and attached materials before any model is queried, so misclassifications and wrong selections are caught early
- **Input quality guardrails** — Weak or vague prompts are flagged and improved before they reach the models, with structural validation that rejects malformed improvements
- **Full cost visibility** — Per-model cost tracked and displayed for every research, including auxiliary costs for generated images and enhanced research runs
- **Resilient to partial failure** — If one model fails, the rest complete; you choose whether to proceed with partial results, retry the failed model, or cancel entirely
- **Start without API keys** — The platform provides fallback access to a subset of models, so you can run research immediately and add more providers over time
- **Safe to retry** — Retrying a failed or partial research does not create duplicate queries or duplicate results

## Limitations

- **No streaming** — Results arrive together once all models respond and synthesis completes, rather than appearing incrementally
- **Five models maximum** — Each research queries up to five providers, one model per provider
- **Five attachments, 60,000 characters each** — Source material slots are capped to keep model context manageable
- **No in-place editing** — Completed research can be enhanced with additional models or context, favourited, shared, exported, or deleted — but the existing synthesis cannot be manually edited
- **Single Notion export** — Re-exporting the same research to Notion is blocked; delete the previous export first
- **Deep research models are slow** — Perplexity's sonar-deep-research and OpenAI's o4-mini-deep-research perform extensive searches during inference, which can take several minutes

---

_Part of [IntexuraOS](../overview.md) — trustworthy answers through structured comparison._
