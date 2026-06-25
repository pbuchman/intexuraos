import React from 'react';
import { motion } from 'framer-motion';
import {
  Brain,
  Code2,
  Layers,
  MessageSquare,
} from 'lucide-react';

export function VoiceSection(): React.JSX.Element {
  const actions = [
    { input: 'Fix the Safari login redirect', output: 'Code change created, tests passing, project tracker updated', icon: Code2, tag: 'CODE' },
    { input: 'Research quantum computing breakthroughs', output: '5-model synthesis with citations and disagreement analysis', icon: Brain, tag: 'RESEARCH' },
    { input: 'Schedule sync with engineering Tuesday 2pm', output: 'Calendar event drafted with the right title, time, and guests', icon: Layers, tag: 'CALENDAR' },
    { input: 'Save this link about TypeScript 5.0', output: 'AI summary generated, metadata extracted, bookmarked', icon: MessageSquare, tag: 'LINK' },
    { input: 'Interesting thought about microservice boundaries', output: 'Note created with tags, searchable later', icon: MessageSquare, tag: 'NOTE' },
  ];

  return (
    <section className="bg-neutral-50 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 max-w-2xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-cyan-600">
            Text-First Intelligence
          </p>
          <h2 className="mb-6 text-4xl font-bold tracking-tight text-neutral-900 md:text-5xl">
            Type.{' '}
            <span className="bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
              It understands.
            </span>
          </h2>
          <p className="mb-6 text-lg leading-relaxed text-neutral-600">
            Five tool types. One interface. Send a WhatsApp text message.
            The system figures out what you meant — even when the wording is imprecise — and
            routes it to the right specialist. Polish and English supported.
          </p>
          <p className="text-sm leading-relaxed text-neutral-500">
            This is not one AI that tries to do everything. It is 24 services, each built for a single domain.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {actions.map((action) => (
            <motion.div
              key={action.tag}
              whileHover={{ y: -5 }}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="group overflow-hidden rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm transition-all hover:shadow-md"
            >
              <div className="mb-3 flex items-center gap-2">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600">
                  <action.icon className="h-4 w-4" />
                </div>
                <span className="text-xs font-semibold tracking-wider text-cyan-700">
                  {action.tag}
                </span>
              </div>
              <div className="mb-3 flex items-start gap-2">
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                <p className="text-sm font-semibold italic text-neutral-900">
                  &quot;{action.input}&quot;
                </p>
              </div>
              <p className="text-sm text-neutral-500">
                → {action.output}
              </p>
            </motion.div>
          ))}
        </div>

        <div className="mt-12">
          <div className="flex items-start gap-4 rounded-xl border border-neutral-100 bg-white p-6">
            <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-cyan-700">Fishing Assistant</p>
              <p className="mt-1 text-sm text-neutral-600">
                Plan sessions, inspect digests, and keep chat history grounded in the fishing knowledge base with source citations.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
