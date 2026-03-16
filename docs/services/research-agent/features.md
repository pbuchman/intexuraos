# Research Agent

Run the same research question through multiple AI models simultaneously and receive one authoritative, cross-validated answer.

## The Problem

A single AI model gives a single perspective. When making important decisions — business strategy, technical architecture, medical questions, legal research — one model's blind spots or hallucinations can mislead. Manually running the same prompt across Gemini, Claude, GPT, and Perplexity, then reconciling their answers, is tedious and error-prone.

Research Agent automates that entire workflow: send one prompt, receive one synthesized report that identifies where models agree, where they diverge, and what each contributed uniquely.

## How It Helps

### Parallel Multi-Model Research

Submit a single research prompt and Research Agent dispatches it simultaneously to every AI model the user has configured — Gemini 2.5 Pro, Claude Opus 4.5, GPT-5.2, Perplexity Sonar, and others. Each model runs concurrently in its own Cloud Run instance, so a five-model research takes roughly the same wall-clock time as a single call.

**Example:** A user asks "What are the risks of adopting a microservices architecture for a 10-person startup?" All five configured models research the question in parallel. Within minutes, the user has five expert perspectives ready for synthesis.

### Intelligent Synthesis with Attribution

Once all models complete, a dedicated synthesis model reads every report and produces a structured output: executive summary, detailed findings organized by theme, explicit agreements between models, contradictions flagged with confidence notes, and unique insights from individual models. Every claim in the synthesis is attributed to the model that made it.

**Example:** Gemini and Claude both warn about operational complexity; GPT uniquely flags DNS management overhead; Perplexity cites three recent case studies. The synthesis surfaces all of this in one readable document without the user needing to manually compare five long outputs.

### Research Enhancement

A completed research can be enhanced rather than re-run from scratch. The user adds new AI models or new context documents to an existing completed research. Prior results are reused — their costs tracked separately — and only the new models are invoked. The synthesis is re-run with the expanded set.

**Example:** After receiving initial results, the user adds a PDF of their current architecture as context and adds Perplexity Deep Research for a second opinion. The enhancement runs only the new model against the new context, then re-synthesizes.

### Automatic Public Sharing

Every completed research automatically generates a self-contained HTML page uploaded to Google Cloud Storage. The page includes the synthesis, individual model reports, a generated cover image, and attribution breakdown. A shareable public URL is created immediately — no manual export step required.

**Example:** A researcher shares their competitive analysis with a client by pasting a single link. The recipient sees a fully formatted report without needing an IntexuraOS account.

### Notion Export

Completed research can be exported to a user-configured Notion page. The synthesis and each individual LLM report become separate Notion sub-pages, with inline cover images, source links, and proper heading structure. Export happens automatically on synthesis completion when Notion is configured.

**Example:** A team that manages all project documentation in Notion receives the research directly in their workspace, organized under the designated research page, without any copy-paste.

### Draft-and-Approve Workflow

Research can be created as a draft by other services — for example, when triggered from a WhatsApp message — and held for user review before any LLM calls are made. The user sees the proposed prompt and selected models, then approves with one click.

**Example:** A user sends a WhatsApp voice note asking IntexuraOS to research a topic. The system creates a draft research and sends a notification. The user reviews the generated prompt on their dashboard and approves it, only then incurring LLM costs.

## Use Case

A product manager needs competitive intelligence before a board meeting. She submits: "Compare the pricing models and market positioning of Notion, Confluence, and Linear for a 50-person engineering team."

Research Agent dispatches the prompt to Gemini 2.5 Pro, Claude Sonnet 4.5, and Perplexity Sonar Pro simultaneously. Gemini Pro focuses on feature depth, Claude Sonnet emphasizes integration ecosystems, Sonar Pro pulls current pricing pages. All three complete within minutes.

The synthesis model reads all three reports and produces a structured document: an executive summary, detailed findings per product, agreements on Notion's document flexibility, and a flagged contradiction between two models' assessments of Confluence pricing. The report is automatically uploaded as a shareable HTML page with a generated cover image.

The PM shares the link in the board pre-read Slack channel and exports it to Notion for the meeting notes.

## Key Benefits

- Eliminate single-model bias by cross-validating across providers
- Identify contradictions and confidence gaps automatically
- Reuse prior results when expanding research — no redundant API costs
- Shareable reports generated automatically with no export friction
- Research organized in Notion without manual copy-paste

## Limitations

- Each input context is limited to 60,000 characters; maximum 5 contexts per research
- Notion export requires a pre-configured target page in user settings
- Partial failures (some models failing) require user confirmation before synthesis proceeds
- Cover image generation requires a Google or OpenAI API key

---

_Part of [IntexuraOS](../overview.md) — Cross-validate AI research so you can trust the answer._
