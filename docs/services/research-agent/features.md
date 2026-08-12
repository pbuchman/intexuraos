# Research Agent

Run the same research question through multiple AI models simultaneously and receive one authoritative, cross-validated answer.

## The Problem

A single AI model gives a single perspective. When making important decisions — business strategy, technical architecture, medical questions, legal research — one model's blind spots or hallucinations can mislead. Manually running the same prompt across Gemini, Claude, GPT, and Perplexity, then reconciling their answers, is tedious and error-prone.

Research Agent automates that entire workflow: send one prompt, receive one synthesized report that identifies where models agree, where they diverge, and what each contributed uniquely.

## How It Helps

### Parallel Multi-Model Research

Submit a single research prompt and Research Agent dispatches it simultaneously to the selected OpenRouter models — Gemini, Claude, GPT, Grok, Qwen, and others. Each model runs concurrently in its own Cloud Run instance, so a five-model research takes roughly the same wall-clock time as a single call.

**Example:** A user asks "What are the risks of adopting a microservices architecture for a 10-person startup?" All five configured models research the question in parallel. Within minutes, the user has five expert perspectives ready for synthesis.

### OpenRouter Integration — Access 16 Frontier Models from 10 Providers

An OpenRouter credential provides access to 16 curated frontier models spanning 10 providers — DeepSeek, Qwen, MiniMax, xAI (Grok), Moonshot (Kimi), Anthropic, Google, OpenAI, Xiaomi, and Z.ai — through one observable route. The `GET /openrouter/models` endpoint returns the full allowlist with live pricing fetched from OpenRouter's catalog API. Models are selected in the frontend and routed through the same parallel research pipeline. Allowlist enforcement at execution time prevents unauthorized model access, and fallback pricing ensures cost tracking works even when live catalog data is unavailable. Google/Gemini models must use an `or:google/...` identifier; raw `gemini-*` identifiers and Google LLM API keys are not accepted.

**Example:** A user selects Grok 4.20 Beta, Kimi K2.5, Gemini 3 Flash Preview, and Claude Sonnet 4.6. All appear in the model selector with live per-token pricing, and every selected model is dispatched through OpenRouter using the same credential and usage trail.

### Context-Aware Research Pipeline

Before dispatching prompts, Research Agent infers a structured research context from the user's question — domain, answer style, preferred source types, time scope, and safety constraints. Each model receives a tailored prompt that includes this context, producing more relevant and focused results. Low-quality model responses (those below the minimum content threshold) are automatically flagged and deprioritized during synthesis.

**Example:** A question about fishing regulations triggers automatic domain detection (`outdoor_recreation`), scopes sources to official regulators and primary documentation, and sets a practical answer style. If one model returns a superficial two-paragraph answer, synthesis treats it as supplementary rather than primary evidence.

### Intelligent Synthesis with Attribution

Once all models complete, a dedicated synthesis model reads every report and produces a structured output: executive summary, detailed findings organized by theme, explicit agreements between models, contradictions flagged with confidence notes, and unique insights from individual models. Every claim in the synthesis is attributed to the model that made it. If attribution validation fails, the service automatically calls the synthesizer again to repair it.

**Example:** OpenRouter-routed Gemini and Claude models both warn about operational complexity; GPT uniquely flags DNS management overhead; another model cites three recent case studies. The synthesis surfaces all of this in one readable document without the user needing to manually compare five long outputs.

### Research Enhancement

A completed research can be enhanced rather than re-run from scratch. The user adds new AI models or new context documents to an existing completed research. Prior results are reused — their costs tracked separately — and only the new models are invoked. The synthesis is re-run with the expanded set.

**Example:** After receiving initial results, the user adds a PDF of their current architecture as context and adds DeepSeek V4 Flash through OpenRouter for a second opinion. The enhancement runs only the new model against the new context, then re-synthesizes.

### Automatic Public Sharing

Every completed research automatically generates a self-contained HTML page uploaded to Google Cloud Storage. The page includes the synthesis, individual model reports, an optional generated cover image, and attribution breakdown. A shareable public URL is created immediately — no manual export step required. Cover images use the OpenAI image pipeline only; when its credential is unavailable or generation fails, the report is still published without a cover image.

**Example:** A researcher shares their competitive analysis with a client by pasting a single link. The recipient sees a fully formatted report without needing an IntexuraOS account. If cover generation fails, the report remains available without delaying publication.

### Notion Export

Completed research can be exported to a user-configured Notion page. The synthesis and each individual LLM report become separate Notion sub-pages, with inline cover images, source links, and proper heading structure. Export happens automatically on synthesis completion when Notion is configured.

**Example:** A team that manages all project documentation in Notion receives the research directly in their workspace, organized under the designated research page, without any copy-paste.

### Draft-and-Approve Workflow

Research can be created as a draft by other services — for example, when triggered from a WhatsApp message — and held for user review before any LLM calls are made. The user sees the proposed prompt and selected models, then approves with one click.

**Example:** A user sends a WhatsApp voice note asking IntexuraOS to research a topic. The system creates a draft research and sends a notification. The user reviews the generated prompt on their dashboard and approves it, only then incurring LLM costs.

### Input Validation and Improvement

Before committing to a full research run, users can validate their prompt quality. The service analyzes the prompt and returns a quality score with reasoning. Weak prompts can be automatically improved — the improved version is returned for user approval before submission.

**Example:** A user submits a vague one-line prompt. The validator flags it as weak and suggests a more specific, structured version. The user accepts the improvement and submits a higher-quality research request, getting better results from every model.

### Important WhatsApp Notifications

Research completion and LLM failure notifications sent via WhatsApp are marked as important, ensuring they receive priority delivery through the notification pipeline and are not suppressed by quiet-hours or batching rules.

**Example:** A long-running five-model research finishes at 11pm. Because the completion notification is marked important, the user receives the WhatsApp message with the share link immediately rather than waiting for the next notification batch.

## Use Case

A product manager needs competitive intelligence before a board meeting. She submits: "Compare the pricing models and market positioning of Notion, Confluence, and Linear for a 50-person engineering team."

Research Agent infers the domain as business strategy, selects an executive answer style, and builds context-enhanced prompts for each model. She selects OpenRouter-routed Gemini 3 Flash Preview, Claude Sonnet 4.6, Grok 4.20 Beta, Kimi K2.5, and Qwen 3.5 Plus for broad coverage. Within minutes, all five complete — but one response is unusually brief and gets flagged as low quality.

The synthesis model reads all five reports, deprioritizing the flagged result, and produces a structured document: an executive summary, detailed findings per product, agreements on Notion's document flexibility, and a flagged contradiction between two models' assessments of Confluence pricing. The report is automatically uploaded as a shareable HTML page with a generated cover image.

The PM shares the link in the board pre-read Slack channel and exports it to Notion for the meeting notes.

## Key Benefits

- Eliminate single-model bias by cross-validating across providers
- Access 16 frontier models from 10 providers through one OpenRouter credential
- Identify contradictions and confidence gaps automatically
- Context-aware prompts produce more relevant, focused research results
- Low-quality responses detected and deprioritized before synthesis
- Reuse prior results when expanding research — no redundant API costs
- Shareable reports generated automatically, with an optional OpenAI-generated cover image
- Research organized in Notion without manual copy-paste
- Important notifications ensure timely delivery of completion alerts

## Limitations

- Each input context is limited to 60,000 characters; maximum 5 contexts per research
- Notion export requires a pre-configured target page in user settings
- Partial failures (some models failing) require user confirmation before synthesis proceeds
- Cover image generation requires an OpenAI API key; Google image generation is disabled
- OpenRouter calls require an OpenRouter credential resolved by user-service (user key or platform fallback)
- OpenRouter model selection is restricted to a curated allowlist of 16 models

---

_Part of [IntexuraOS](../overview.md) — Cross-validate AI research so you can trust the answer._
