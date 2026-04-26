import React from 'react';
import { motion } from 'framer-motion';
import {
  Bell,
  CheckCircle2,
  GitPullRequest,
  Layers,
  MessageSquare,
  Smartphone,
} from 'lucide-react';

export function IntegrationsSection(): React.JSX.Element {
  const integrations = [
    { name: 'WhatsApp', description: 'Mobile command center — voice notes, text, approvals', icon: Smartphone },
    { name: 'Google Calendar', description: 'Events from voice, previewed before creation', icon: Layers },
    { name: 'Linear', description: 'Project tracking with real-time board sync', icon: CheckCircle2 },
    { name: 'Notion', description: 'Export research reports as structured pages', icon: MessageSquare },
    { name: 'GitHub', description: 'PRs, code reviews, and feedback loops', icon: GitPullRequest },
    { name: 'Android', description: 'Notification capture and mobile alerts', icon: Bell },
  ];

  return (
    <section className="bg-neutral-50 px-6 py-16">
      <div className="mx-auto max-w-7xl">
        <p className="mb-8 text-center text-sm font-medium uppercase tracking-wider text-neutral-500">
          Connected Services
        </p>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {integrations.map((integration) => (
            <motion.div
              key={integration.name}
              whileHover={{ y: -3 }}
              className="flex flex-col items-center rounded-xl border border-neutral-200 bg-white p-4 text-center shadow-sm transition-all hover:shadow-md"
            >
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600">
                <integration.icon className="h-5 w-5" />
              </div>
              <div className="text-xs font-semibold text-neutral-900">{integration.name}</div>
              <div className="mt-1 text-xs text-neutral-500">{integration.description}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
