import React from 'react';
import { motion } from 'framer-motion';
import {
  BellOff,
  Brain,
  CheckCircle2,
  DollarSign,
  Flag,
  MessageSquare,
  RefreshCw,
  Settings,
  Smartphone,
  SplitSquareVertical,
  Tags,
  Workflow,
} from 'lucide-react';

interface FeatureEntry {
  title: string;
  description: string;
  icon: React.ElementType;
  borderColor: string;
  bgGradient: string;
  iconBg: string;
  iconColor: string;
}

export function WhatsNewSection(): React.JSX.Element {
  const features: FeatureEntry[] = [
    {
      title: 'WhatsApp Group Digests',
      description:
        'End-to-end pipeline turns WhatsApp group messages into AI-generated daily digest summaries.',
      icon: MessageSquare,
      borderColor: 'border-emerald-200',
      bgGradient: 'bg-gradient-to-br from-emerald-50 to-white',
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-700',
    },
    {
      title: 'Centralized LLM Pricing',
      description:
        'Single shared pricing package replaces duplicated definitions across 9 services.',
      icon: DollarSign,
      borderColor: 'border-cyan-200',
      bgGradient: 'bg-gradient-to-br from-cyan-50 to-white',
      iconBg: 'bg-cyan-100',
      iconColor: 'text-cyan-700',
    },
    {
      title: 'Notification Importance Filter',
      description:
        'Suppress low-priority WhatsApp notifications with an importance level filter.',
      icon: BellOff,
      borderColor: 'border-purple-200',
      bgGradient: 'bg-gradient-to-br from-purple-50 to-white',
      iconBg: 'bg-purple-100',
      iconColor: 'text-purple-700',
    },
    {
      title: 'LLM Model Fallback',
      description:
        'Primary and fallback default model selection with automatic retry when primary is unavailable.',
      icon: RefreshCw,
      borderColor: 'border-blue-200',
      bgGradient: 'bg-gradient-to-br from-blue-50 to-white',
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-700',
    },
    {
      title: 'Prompt Type Tracking',
      description:
        'End-to-end tracking through the LLM call stack shows which prompt drove each usage entry.',
      icon: Tags,
      borderColor: 'border-violet-200',
      bgGradient: 'bg-gradient-to-br from-violet-50 to-white',
      iconBg: 'bg-violet-100',
      iconColor: 'text-violet-700',
    },
    {
      title: 'Task Mode Selector',
      description:
        'Explicitly choose between planning and execution mode when starting a task.',
      icon: SplitSquareVertical,
      borderColor: 'border-amber-200',
      bgGradient: 'bg-gradient-to-br from-amber-50 to-white',
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-700',
    },
    {
      title: 'PWA Resilience',
      description:
        'Improved Progressive Web App stability on Android HyperOS.',
      icon: Smartphone,
      borderColor: 'border-green-200',
      bgGradient: 'bg-gradient-to-br from-green-50 to-white',
      iconBg: 'bg-green-100',
      iconColor: 'text-green-700',
    },
    {
      title: 'Pub/Sub PR Triage',
      description:
        'PR triage processing moved to Pub/Sub push so it no longer blocks the main request path.',
      icon: Workflow,
      borderColor: 'border-rose-200',
      bgGradient: 'bg-gradient-to-br from-rose-50 to-white',
      iconBg: 'bg-rose-100',
      iconColor: 'text-rose-700',
    },
    {
      title: 'Robust Task Finalization',
      description:
        'Dedicated status endpoint ensures code tasks complete correctly instead of stalling.',
      icon: CheckCircle2,
      borderColor: 'border-indigo-200',
      bgGradient: 'bg-gradient-to-br from-indigo-50 to-white',
      iconBg: 'bg-indigo-100',
      iconColor: 'text-indigo-700',
    },
    {
      title: 'Issue Group Importance',
      description:
        'Mark issue groups as high-priority with an important flag.',
      icon: Flag,
      borderColor: 'border-orange-200',
      bgGradient: 'bg-gradient-to-br from-orange-50 to-white',
      iconBg: 'bg-orange-100',
      iconColor: 'text-orange-700',
    },
    {
      title: 'Execution Memory Simplification',
      description:
        'Simplified pipeline reduces complexity and improves orchestrator maintainability.',
      icon: Brain,
      borderColor: 'border-teal-200',
      bgGradient: 'bg-gradient-to-br from-teal-50 to-white',
      iconBg: 'bg-teal-100',
      iconColor: 'text-teal-700',
    },
    {
      title: 'Agent Model Inheritance',
      description:
        'Code agent inherits user default LLM model settings instead of using hardcoded model.',
      icon: Settings,
      borderColor: 'border-sky-200',
      bgGradient: 'bg-gradient-to-br from-sky-50 to-white',
      iconBg: 'bg-sky-100',
      iconColor: 'text-sky-700',
    },
  ];

  return (
    <section className="bg-white px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 max-w-2xl">
          <div className="flex items-center gap-3">
            <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-cyan-600">What's New</p>
            <a
              href="https://github.com/pbuchman/intexuraos/blob/main/CHANGELOG.md"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View full changelog"
              className="mb-4 ml-auto text-xs font-medium text-neutral-400 transition-colors hover:text-cyan-600"
            >
              Full Changelog →
            </a>
          </div>
          <h2 className="mb-6 text-4xl font-bold tracking-tight text-neutral-900 md:text-5xl">
            v3.6.0 —{' '}
            <span className="bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
              12 new capabilities.
            </span>
          </h2>
          <p className="text-lg leading-relaxed text-neutral-600">
            WhatsApp Group Digests, Centralized LLM Pricing, Notification Importance Filter, and more.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <motion.div
                key={feature.title}
                whileHover={{ y: -5 }}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className={`overflow-hidden rounded-2xl border ${feature.borderColor} ${feature.bgGradient} p-6 shadow-sm transition-all hover:shadow-md`}
              >
                <div className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl ${feature.iconBg} ${feature.iconColor}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mb-2 text-lg font-bold text-neutral-900">{feature.title}</h3>
                <p className="text-neutral-600">{feature.description}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
