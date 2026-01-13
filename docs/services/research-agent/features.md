# Research Agent

The AI-powered research orchestration engine that queries multiple LLM providers simultaneously and synthesizes comprehensive answers.

## The Problem

Getting comprehensive information from AI models today is fragmented:

1. **Single-model limitations** - Each AI model has unique knowledge and perspectives
2. **Manual aggregation** - Users must query multiple sources and combine results themselves
3. **Missing attribution** - AI responses often lack source citations
4. **Cost uncertainty** - Token usage and costs are unclear until after the fact
5. **No sharing** - Research results can't be easily shared with others

## How It Helps

Research-agent automates multi-model AI research:

1. **Parallel queries** - Sends your prompt to multiple LLMs simultaneously (Claude, GPT-4, Gemini, Perplexity)
2. **Smart synthesis** - Combines all responses into a comprehensive, attributed summary
3. **Cost tracking** - Shows token usage and cost for each model in real-time
4. **Public sharing** - Generates shareable URLs with AI-generated cover images
5. **Context enhancement** - Add your own articles, notes, or previous research as context

## Use Cases

### Multi-Model Research

- "What are the latest developments in quantum computing?"
- Research-agent queries Claude, GPT-4, Gemini, and Perplexity in parallel
- Each model provides its unique perspective and sources
- Results are synthesized into a comprehensive answer

### Enhanced Research with Context

- Add your own articles as input context
- Reference previous research as source material
- The synthesis includes and attributes your provided context

### Draft Research Approval Flow

- Actions-agent creates a "draft" research when confidence is low
- User reviews the draft in the web UI
- User approves and research-agent processes the query
- User receives WhatsApp notification when complete

### Research Sharing

- Completed research automatically generates a shareable URL
- AI generates a cover image for the research
- Share URL includes attribution and sources
- Unsharing removes the public page and deletes associated media

## Key Benefits

**Comprehensive answers** - Multiple AI perspectives provide more complete information

**Cost transparency** - See exactly what each query costs before and after execution

**Attribution tracking** - Know which model contributed which information

**Idempotent processing** - Safe retry of failed LLM calls without duplication

**Smart failure handling** - Partial failures don't block completion; users decide how to proceed

**Public sharing** - Share research results with clean, attributed URLs

## Limitations

**API key required** - Users must provide their own API keys for each LLM provider

**Max 6 models** - Research is limited to 6 simultaneous models to control costs

**Max 5 input contexts** - Each context max 60k characters for context window limits

**No streaming** - Research results are returned in bulk when complete (not real-time)

**Perplexity special handling** - Perplexity requires online search and has longer response times

**No editing** - Once research is completed, it cannot be edited (only enhanced or deleted)
