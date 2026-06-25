import React from 'react';
import { motion } from 'framer-motion';
import {
  BookOpenCheck,
  Brain,
  CalendarCheck,
  Code2,
  FileText,
  MessageSquare,
  Network,
  ShieldCheck,
} from 'lucide-react';

interface AgentPattern {
  title: string;
  service: string;
  proof: string;
  icon: React.ElementType;
  accent: string;
}

const patterns: AgentPattern[] = [
  {
    title: 'Direct-tool action agent',
    service: 'intex-agent',
    proof: 'Tool-gated WhatsApp routing exposes one supported action at a time.',
    icon: MessageSquare,
    accent: 'bg-cyan-50 text-cyan-700',
  },
  {
    title: 'Multi-model research council',
    service: 'research-agent',
    proof: 'Parallel providers synthesize with attribution and disagreement tracking.',
    icon: Brain,
    accent: 'bg-blue-50 text-blue-700',
  },
  {
    title: 'Citation-validated RAG',
    service: 'fishing-assistant-service',
    proof: 'Knowledge, digests, and raw messages become cited answers with repair.',
    icon: BookOpenCheck,
    accent: 'bg-emerald-50 text-emerald-700',
  },
  {
    title: 'Stateful writing agent',
    service: 'hellscript-agent',
    proof: 'Utterances become durable buffer events before drafts are generated.',
    icon: FileText,
    accent: 'bg-violet-50 text-violet-700',
  },
  {
    title: 'Extraction-to-action agents',
    service: 'calendar-agent / linear-agent',
    proof: 'Natural language becomes validated external side effects or reviewable failures.',
    icon: CalendarCheck,
    accent: 'bg-amber-50 text-amber-700',
  },
  {
    title: 'Autonomous code execution',
    service: 'code-agent + orchestrator',
    proof: 'Local isolated workers plan, execute, verify, retry, and deliver PRs.',
    icon: Code2,
    accent: 'bg-slate-100 text-slate-700',
  },
];

export function AgentPatternsSection(): React.JSX.Element {
  return (
    <section className="bg-white px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 max-w-3xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-cyan-600">
            Agentic Patterns In Production
          </p>
          <h2 className="mb-6 text-4xl font-bold tracking-tight text-neutral-900 md:text-5xl">
            Not one assistant.{' '}
            <span className="bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
              A system of safe specialists.
            </span>
          </h2>
          <p className="text-lg leading-relaxed text-neutral-600">
            Each agent has a bounded job, typed interfaces, and explicit failure paths. The model
            brings judgment; the software decides what it may touch.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {patterns.map((pattern) => {
            const Icon = pattern.icon;
            return (
              <motion.div
                key={pattern.title}
                whileHover={{ y: -5 }}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm transition-all hover:shadow-md"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${pattern.accent}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-1 text-[11px] font-semibold text-neutral-500">
                    <ShieldCheck className="h-3 w-3 text-emerald-500" />
                    bounded
                  </div>
                </div>
                <h3 className="mb-1 text-lg font-bold text-neutral-900">{pattern.title}</h3>
                <p className="mb-3 font-mono text-xs font-semibold text-cyan-700">{pattern.service}</p>
                <p className="text-sm leading-relaxed text-neutral-600">{pattern.proof}</p>
              </motion.div>
            );
          })}
        </div>

        <div className="mt-10 flex items-start gap-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-6">
          <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-cyan-700 shadow-sm">
            <Network className="h-5 w-5" />
          </div>
          <p className="text-sm leading-relaxed text-neutral-600">
            The value is the placement: LLMs operate inside service ownership, prompt versioning,
            usage attribution, schema validation, and recoverable workflows.
          </p>
        </div>
      </div>
    </section>
  );
}
