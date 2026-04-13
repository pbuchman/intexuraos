# Research Agent

Run the same research question through multiple AI models simultaneously and receive one authoritative, cross-validated answer.

## The Problem

A single AI model gives a single perspective. When making important decisions -- business strategy, technical architecture, medical questions, legal research -- one model's blind spots or hallucinations can mislead. Manually running the same prompt across Gemini, Claude, GPT, and Perplexity, then reconciling their answers, is tedious and error-prone.

Research Agent automates that entire workflow: send one prompt, receive one synthesized report that identifies where models agree, where they diverge, and what each contributed uniquely.

## How It Helps

### Parallel Multi-Model Research

Submit a single research prompt and Research Agent dispatches it simultaneously to every AI model the user has configured -- Gemini 2.5 Pro, Claude Opus 4.6, GPT-5.4, Perplexity Sonar, and others. Each model runs concurrently in its own Cloud Run instance, so a five-model research takes roughly the same wall-clock time as a single call.

**Example:** A user asks "What are the risks of adopting a microservices architecture for a 10-person startup?" All five configured models research the question in parallel. Within minutes, the user has five expert perspectives ready for synthesis.

### OpenRouter Integration -- Access 14 Frontier Models from 10 Providers

Users with an OpenRouter API key gain access to 14 curated frontier models spanning 10 providers -- Qwen, MiniMax, xAI (Grok), Moonshot (Kimi), Anthropic, Google, OpenAI, Xiaomi, and Z.ai -- through a single key. The `GET /research/openrouter/models` endpoint returns the full allowlist with live pricing fetched from OpenRouter's catalog API. Models are selected in the frontend and routed through the same parallel research pipeline as native providers. Allowlist enforcement at execution time prevents unauthorized model access, and fallback pricing ensures cost tracking works even when live catalog data is unavailable.

**Example:** A user configures one OpenRouter API key and immediately gains access to Grok 4.20 Beta, Kimi K2.5, MiMo V2 Pro, and GPT-5.4 -- models not available through direct provider keys. All appear in the model selector with live per-token pricing, and research dispatches them through the same parallel pipeline as Google or Anthropic models.

### Context-Aware Research Pipeline

Before dispatching prompts, Research Agent infers a structured research context from the user's question -- domain, answer style, preferred source types, time scope, and safety constraints. Each model receives a tailored prompt that includes this context, producing more relevant and focused results. Low-quality model responses (those below the minimum content threshold) are automatically flagged and deprioritized during synthesis.

**Example:** A question about fishing regulations triggers automatic domain detection (`outdoor_recreation`), scopes sources to official regulators and primary documentation, and sets a practical answer style. If one model returns a superficial two-paragraph answer, synthesis treats it as supplementary rather than primary evidence.

### Intelligent Synthesis with Attribution

Once all models complete, a dedicated synthesis model reads every report and produces a structured output: executive summary, detailed findings organized by theme, explicit agreements between models, contradictions flagged with confidence notes, and unique insights from individual models. Every claim in the synthesis is attributed to the model that made it. If attribution validation fails, the service automatically calls the synthesizer again to repair it.

**Example:** Gemini and Claude both warn about operational complexity; GPT uniquely flags DNS management overhead; Perplexity cites three recent case studies. The synthesis surfaces all of this in one readable document without the user needing to manually compare five long outputs.

### Research Enhancement

A completed research can be enhanced rather than re-run from scratch. The user adds new AI models or new context documents to an existing completed research. Prior results are reused -- their costs tracked separately -- and only the new models are invoked. The synthesis is re-run with the expanded set.

**Example:** After receiving initial results, the user adds a PDF of their current architecture as context and adds Perplexity Deep Research for a second opinion. The enhancement runs only the new model against the new context, then re-synthesizes.

### Automatic Public Sharing with Provider Failover

Every completed research automatically generates a self-contained HTML page uploaded to Google Cloud Storage. The page includes the synthesis, individual model reports, a generated cover image, and attribution breakdown. A shareable public URL is created immediately -- no manual export step required. Cover image generation supports provider failover: if the preferred image provider fails (Google or OpenAI), the service automatically falls back to the other available provider, so shared reports still get cover images even when one provider is temporarily unavailable.

**Example:** A researcher shares their competitive analysis with a client by pasting a single link. The recipient sees a fully formatted report without needing an IntexuraOS account. If the primary image provider was down during generation, the fallback provider produced the cover image transparently.

### Notion Export

Completed research can be exported to a user-configured Notion page. The synthesis and each individual LLM report become separate Notion sub-pages, with inline cover images, source links, and proper heading structure. Export happens automatically on synthesis completion when Notion is configured.

**Example:** A team that manages all project documentation in Notion receives the research directly in their workspace, organized under the designated research page, without any copy-paste.

### Draft-and-Approve Workflow

Research can be created as a draft by other services -- for example, when triggered from a WhatsApp message -- and held for user review before any LLM calls are made. The user sees the proposed prompt and selected models, then approves with one click.

**Example:** A user sends a WhatsApp voice note asking IntexuraOS to research a topic. The system creates a draft research and sends a notification. The user reviews the generated prompt on their dashboard and approves it, only then incurring LLM costs.

### Input Validation and Improvement

Before committing to a full research run, users can validate their prompt quality. The service analyzes the prompt and returns a quality score with reasoning. Weak prompts can be automatically improved -- the improved version is returned for user approval before submission.

**Example:** A user submits a vague one-line prompt. The validator flags it as weak and suggests a more specific, structured version. The user accepts the improvement and submits a higher-quality research request, getting better results from every model.

## Use Case

A product manager needs competitive intelligence before a board meeting. She submits: "Compare the pricing models and market positioning of Notion, Confluence, and Linear for a 50-person engineering team."

Research Agent infers the domain as business strategy, selects an executive answer style, and builds context-enhanced prompts for each model. Gemini 2.5 Pro, Claude Sonnet 4.6, and Perplexity Sonar Pro each receive the tailored prompt and research the question in parallel. She also adds two OpenRouter models -- Grok 4.20 Beta and Kimi K2.5 -- for broader coverage. Within minutes, all five complete -- but Sonar Pro's response is unusually brief and gets flagged as low quality.

The synthesis model reads all five reports, deprioritizing the flagged result, and produces a structured document: an executive summary, detailed findings per product, agreements on Notion's document flexibility, and a flagged contradiction between two models' assessments of Confluence pricing. The report is automatically uploaded as a shareable HTML page with a generated cover image.

The PM shares the link in the board pre-read Slack channel and exports it to Notion for the meeting notes.

## Key Benefits

- Eliminate single-model bias by cross-validating across providers
- Access 14 frontier models from 10 providers through a single OpenRouter key
- Identify contradictions and confidence gaps automatically
- Context-aware prompts produce more relevant, focused research results
- Low-quality responses detected and deprioritized before synthesis
- Reuse prior results when expanding research -- no redundant API costs
- Shareable reports generated automatically with cover image provider failover
- Research organized in Notion without manual copy-paste

## Limitations

- Each input context is limited to 60,000 characters; maximum 5 contexts per research
- Notion export requires a pre-configured target page in user settings
- Partial failures (some models failing) require user confirmation before synthesis proceeds
- Cover image generation requires a Google or OpenAI API key
- OpenRouter models require a valid OpenRouter API key configured in user settings
- OpenRouter model selection is restricted to a curated allowlist of 14 models

---

_Part of [IntexuraOS](../overview.md) -- Cross-validate AI research so you can trust the answer._
