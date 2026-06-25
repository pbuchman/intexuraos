import React from 'react';
import { motion } from 'framer-motion';
import { Brain, Eye, Layers, Zap } from 'lucide-react';

export function CouncilSection(): React.JSX.Element {
  const providers = [
    { name: 'ANTHROPIC', models: '4 models: reasoning, coding, speed', role: 'Analysis, validation, autonomous coding', icon: Brain },
    { name: 'OPENAI', models: '4 models: research, reasoning, images', role: 'Deep research, synthesis, embeddings', icon: Zap },
    { name: 'GOOGLE', models: '4 models: analysis, classification, images', role: 'Classification, routing, image gen', icon: Layers },
    { name: 'PERPLEXITY', models: '3 models: search, synthesis, deep dive', role: 'Real-time web search, citations', icon: Eye },
  ];

  return (
    <section className="bg-neutral-950 px-6 py-24 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16">
          <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">
            The Council of AI
          </p>
          <h2 className="mb-6 max-w-3xl text-4xl font-bold tracking-tight md:text-5xl">
            A multi-model research council.{' '}
            <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
              With attribution.
            </span>
          </h2>
          <p className="max-w-2xl text-lg leading-relaxed text-neutral-400">
            The research-agent can run a multi-model research council across 15 configured models.
            It surfaces agreement, disagreement, citations, and model attribution instead of flattening
            every response into one opaque answer.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {providers.map((provider) => (
            <motion.div
              key={provider.name}
              whileHover={{ y: -5, backgroundColor: 'rgba(255,255,255,0.1)' }}
              className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 text-center backdrop-blur-sm transition-colors"
            >
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-800 text-neutral-300">
                <provider.icon className="h-6 w-6" />
              </div>
              <h3 className="mb-1 text-lg font-bold">{provider.name}</h3>
              <p className="mb-2 font-mono text-xs text-cyan-400">{provider.models}</p>
              <p className="text-sm text-neutral-500">{provider.role}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-12 border-t border-neutral-800 pt-8">
          <p className="text-sm text-neutral-500">
            Specify models in natural language: &quot;Research AI trends with Claude and GPT&quot; — or let
            the system choose. Every LLM call is tracked by model, tokens, and cost so the result can
            be inspected after synthesis.
          </p>
        </div>
      </div>
    </section>
  );
}
