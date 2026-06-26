import React from 'react';
import { motion } from 'framer-motion';
import { MessagesSquare, Workflow } from 'lucide-react';

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
      title: 'Intex Agent Unified Actions',
      description:
        'One Intex Agent workflow now creates code tasks, research drafts, bookmarks, notes, and calendar actions.',
      icon: Workflow,
      borderColor: 'border-emerald-200',
      bgGradient: 'bg-gradient-to-br from-emerald-50 to-white',
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-700',
    },
    {
      title: 'Private WhatsApp Workspace',
      description:
        'Mirror and inspect private WhatsApp conversations with group context, sender/day views, Matrix sync, and read-only logs.',
      icon: MessagesSquare,
      borderColor: 'border-cyan-200',
      bgGradient: 'bg-gradient-to-br from-cyan-50 to-white',
      iconBg: 'bg-cyan-100',
      iconColor: 'text-cyan-700',
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
            v3.8.0 —{' '}
            <span className="bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
              unified actions, private WhatsApp.
            </span>
          </h2>
          <p className="text-lg leading-relaxed text-neutral-600">
            Intex Agent now owns the action path, and private WhatsApp has a dedicated workspace.
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
