import React from 'react';
import { motion } from 'framer-motion';
import {
  Brain,
  CheckCircle2,
  Code2,
  Container,
  Eye,
  GitPullRequest,
  Lock,
  Shield,
  Zap,
} from 'lucide-react';
import { ModernCard } from './ModernCard.js';
import { PipelineStep } from './PipelineStep.js';

export function SelfBuildingSection(): React.JSX.Element {
  return (
    <section className="bg-white px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 max-w-2xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-cyan-600">
            The Self-Building System
          </p>
          <h2 className="mb-6 text-4xl font-bold tracking-tight text-neutral-900 md:text-5xl">
            Describe the change.{' '}
            <span className="bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
              Receive a pull request.
            </span>
          </h2>
          <p className="mb-6 text-lg leading-relaxed text-neutral-600">
            Most AI coding tools wait for you to sit at a keyboard. IntexuraOS doesn&apos;t. You describe
            what needs to change — while walking, while commuting, wherever the idea hits.
            The platform designs the approach, writes the code in a sealed container on your
            machine, runs the full test suite, creates a code change for review, and updates the
            project issue. If verification fails, it retries with preserved context.
          </p>
          <p className="text-sm leading-relaxed text-neutral-500">
            24 services communicate over authenticated HTTP. No shared databases. Each service owns its data.
          </p>
        </div>

        <div className="mb-16 grid gap-6 md:grid-cols-2">
          <motion.div
            whileHover={{ y: -5 }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="overflow-hidden rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-white p-6 shadow-sm transition-all hover:shadow-md"
          >
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700">
              <Lock className="h-6 w-6" />
            </div>
            <h3 className="mb-2 text-lg font-bold text-neutral-900">Your Code Never Leaves Your Network</h3>
            <p className="text-neutral-600">
              Cursor and Copilot send your code to the cloud. IntexuraOS runs on your machine, inside
              isolated containers, powered by your own AI subscription. Your source code stays where it belongs.
            </p>
          </motion.div>
          <motion.div
            whileHover={{ y: -5 }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6 shadow-sm transition-all hover:shadow-md"
          >
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <Eye className="h-6 w-6" />
            </div>
            <h3 className="mb-2 text-lg font-bold text-neutral-900">You Approve Before It Runs</h3>
            <p className="text-neutral-600">
              You approve the design before code runs. Calendar events before they are created.
              High-stakes actions before they execute. You stay in control without becoming a bottleneck.
            </p>
          </motion.div>
        </div>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          <PipelineStep
            number="Step 1"
            title="Plan"
            description="A planning agent analyzes the task, enriches the project issue with technical context, creates subissues for complex work, and labels it code-task when the plan is sound."
            icon={Brain}
            accent="bg-purple-100 text-purple-700"
          />
          <PipelineStep
            number="Step 2"
            title="Execute"
            description="A strict execution agent picks up the labeled issue, writes code in an isolated container on your machine, runs the full test suite, and creates a code change for review."
            icon={Code2}
            accent="bg-blue-100 text-blue-700"
          />
          <PipelineStep
            number="Verify"
            title="Check"
            description="An independent verifier checks the work against completion criteria: correct files modified, tests passing, code change created. If not, the system resumes automatically."
            icon={CheckCircle2}
            accent="bg-green-100 text-green-700"
          />
          <PipelineStep
            number="Deliver"
            title="Ship"
            description="Code change created, project issue moved to In Review, WhatsApp notification sent. You review and merge when ready. The platform did the rest."
            icon={GitPullRequest}
            accent="bg-cyan-100 text-cyan-700"
          />
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          <ModernCard title="No Task Sees Another" icon={Container}>
            <p className="text-neutral-600">
              Two concurrent tasks never see each other&apos;s files, messages, or credentials.
              Each runs in its own sealed container with restricted permissions.
            </p>
          </ModernCard>
          <ModernCard title="Tamper-Proof Delivery" icon={Shield}>
            <p className="text-neutral-600">
              Your conversations and code cannot be intercepted or seen by other tasks.
              All communication between services is cryptographically signed, timestamped, and
              delivered through a private tunnel. No exposed endpoints.
            </p>
          </ModernCard>
          <ModernCard title="Automatic Retry" icon={Zap}>
            <p className="text-neutral-600">
              Failed tasks preserve full context and retry with a 1-minute cool-off. Messages queue
              during execution and trigger resume on completed tasks.
            </p>
          </ModernCard>
        </div>
      </div>
    </section>
  );
}
