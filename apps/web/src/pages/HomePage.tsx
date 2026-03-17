import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code2,
  Container,
  Eye,
  GitPullRequest,
  GitPullRequestArrow,
  Globe,
  Layers,
  LayoutGrid,
  Lock,
  Mail,
  MessageSquare,
  Mic,
  ScrollText,
  Shield,
  Smartphone,
  Sparkles,
  Terminal,
  Waypoints,
  Zap,
} from 'lucide-react';
import React from 'react';
import { motion } from 'framer-motion';
import { HeroShowcase } from '@/components/home/HeroShowcase.js';

// --- Brand Icons ---

function LinkedinIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function GithubIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

// --- Shared Components ---

function ModernCard({
  children,
  className = '',
  title,
  icon: Icon,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  icon?: React.ElementType;
}): React.JSX.Element {
  return (
    <motion.div
      whileHover={{ y: -5 }}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={`group relative overflow-hidden rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm transition-all hover:shadow-md ${className}`}
    >
      {title && (
        <>
          {Icon && (
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600 transition-colors group-hover:bg-cyan-600 group-hover:text-white">
              <Icon className="h-6 w-6" />
            </div>
          )}
          <h3 className="mb-2 text-lg font-bold text-neutral-900">{title}</h3>
        </>
      )}
      {children}
    </motion.div>
  );
}

// --- Stat Counter ---

function StatBlock({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <div className="text-center">
      <div className="text-4xl font-extrabold tracking-tight text-neutral-900 md:text-5xl">{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </div>
    </div>
  );
}

// --- Pipeline Step ---

function PipelineStep({
  number,
  title,
  description,
  icon: Icon,
  accent,
}: {
  number: string;
  title: string;
  description: string;
  icon: React.ElementType;
  accent: string;
}): React.JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="group relative"
    >
      <div className={`mb-4 inline-flex items-center gap-3 rounded-full ${accent} px-4 py-2 text-sm font-semibold`}>
        <Icon className="h-4 w-4" />
        {number}
      </div>
      <h3 className="mb-2 text-xl font-bold text-neutral-900">{title}</h3>
      <p className="text-neutral-600 leading-relaxed">{description}</p>
    </motion.div>
  );
}

// --- Sections ---

function Navbar(): React.JSX.Element {
  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed top-0 z-50 w-full border-b border-white/10 bg-white/80 backdrop-blur-md"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-cyan-600" />
          <span className="font-bold tracking-tight text-neutral-900">IntexuraOS</span>
        </Link>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/pbuchman/intexuraos"
            className="hidden items-center gap-1 text-sm font-medium text-neutral-600 transition-colors hover:text-cyan-600 sm:flex"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GithubIcon className="h-4 w-4" /> GitHub
          </a>
          <Link
            to="/login"
            className="rounded-full bg-black px-6 py-2 text-sm font-semibold text-white transition-transform hover:scale-105 hover:bg-neutral-800 active:scale-95"
          >
            Log In
          </Link>
        </div>
      </div>
    </motion.nav>
  );
}

function HeroSection(): React.JSX.Element {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-cyan-50 to-white pb-24 pt-32">
      <div className="absolute -translate-y-24 left-0 right-0 top-0 h-[500px] -skew-y-6 transform bg-gradient-to-br from-blue-100/50 via-cyan-50/30 to-transparent" />

      <div className="relative mx-auto max-w-7xl px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://www.linkedin.com/in/piotrbuchman/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white/60 px-3 py-1 text-xs font-medium text-neutral-700 shadow-sm backdrop-blur-sm transition-colors hover:text-cyan-600"
            >
              <LinkedinIcon className="h-3.5 w-3.5" /> LinkedIn
            </a>
            <a
              href="https://github.com/pbuchman/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white/60 px-3 py-1 text-xs font-medium text-neutral-700 shadow-sm backdrop-blur-sm transition-colors hover:text-cyan-600"
            >
              <GithubIcon className="h-3.5 w-3.5" /> GitHub
            </a>
            <a
              href="mailto:kontakt@pbuchman.com"
              className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white/60 px-3 py-1 text-xs font-medium text-neutral-700 shadow-sm backdrop-blur-sm transition-colors hover:text-cyan-600"
            >
              <Mail className="h-3.5 w-3.5" /> Email
            </a>
          </div>

          <div className="mx-auto mb-6 flex max-w-fit items-center gap-2 rounded-full border border-cyan-200 bg-white/60 px-4 py-1.5 text-sm font-medium text-cyan-900 shadow-sm backdrop-blur-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500" />
            </span>
            IntexuraOS v3.3.0
          </div>

          <p className="mx-auto mb-4 max-w-xl text-lg leading-relaxed text-neutral-600">
            You remember the bug while walking to lunch. You think of a research question on the commute home.
            You are not at a keyboard.
          </p>

          <h1 className="mx-auto mb-8 max-w-4xl text-5xl font-extrabold tracking-tight text-neutral-900 md:text-7xl lg:text-[5.5rem] lg:leading-[1]">
            Say it.{' '}
            <span className="bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
              It
            </span>
            <br />
            happens.
          </h1>

          <p className="mx-auto mb-4 max-w-2xl text-lg leading-relaxed text-neutral-600 md:text-xl">
            Send a WhatsApp voice note while walking. Come back to a calendar event created,
            research synthesized from five AI models, code written and tested, project
            task tracked. This is not a convenience shortcut to a desktop workflow.
            It is a fundamentally different interaction model.
          </p>

          <p className="mx-auto mb-10 max-w-2xl text-lg font-semibold leading-relaxed text-neutral-500">
            ChatGPT voice gives you an answer. IntexuraOS gives you a calendar event, a pull request, or a research report.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              to="/login"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-cyan-600 px-8 text-base font-semibold text-white shadow-lg shadow-cyan-600/20 transition-all hover:-translate-y-0.5 hover:bg-cyan-700"
            >
              Log In <ChevronRight className="h-4 w-4" />
            </Link>
            <a
              href="https://github.com/pbuchman/intexuraos"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white px-8 text-base font-semibold text-neutral-900 transition-all hover:border-neutral-300 hover:bg-neutral-50"
            >
              View Source <GithubIcon className="h-4 w-4" />
            </a>
          </div>
          <p className="mt-4 text-xs text-neutral-500">
            New here? Signing up takes 2 minutes. The login page handles both.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.8 }}
          className="relative mx-auto mt-20 max-w-6xl"
        >
          <HeroShowcase />
        </motion.div>
      </div>
    </section>
  );
}

function StatsSection(): React.JSX.Element {
  return (
    <section className="bg-white px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <p className="mb-8 text-center text-sm font-medium uppercase tracking-wider text-neutral-500">
          Built for one person. Not a team tool.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-8">
          <StatBlock value="24" label="Services" />
          <StatBlock value="8" label="Action Types" />
          <StatBlock value="5" label="AI Providers" />
          <StatBlock value="16" label="AI Models" />
          <StatBlock value="1" label="Developer" />
        </div>
      </div>
    </section>
  );
}

function VoiceSection(): React.JSX.Element {
  const actions = [
    { input: 'Fix the Safari login redirect', output: 'Code change created, tests passing, project tracker updated', icon: Code2, tag: 'CODE' },
    { input: 'Research quantum computing breakthroughs', output: '5-model synthesis with citations and disagreement analysis', icon: Brain, tag: 'RESEARCH' },
    { input: 'Schedule sync with engineering Tuesday 2pm', output: 'Preview shown, approved via emoji, event created', icon: Layers, tag: 'CALENDAR' },
    { input: 'Remind me to review Q4 report by Friday', output: 'Task extracted with priority and deadline', icon: CheckCircle2, tag: 'TODO' },
    { input: 'Save this link about TypeScript 5.0', output: 'AI summary generated, metadata extracted, bookmarked', icon: MessageSquare, tag: 'LINK' },
    { input: 'Track the auth refactor as a project issue', output: 'Issue filed with AI-generated title and description', icon: Bot, tag: 'PROJECT' },
    { input: 'Interesting thought about microservice boundaries', output: 'Note created with tags, searchable later', icon: MessageSquare, tag: 'NOTE' },
    { input: 'Remind me to check CI at 5pm', output: 'Timed reminder set, notification delivered on schedule', icon: Clock, tag: 'REMINDER' },
  ];

  return (
    <section className="bg-neutral-50 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 max-w-2xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-cyan-600">
            Voice-First Intelligence
          </p>
          <h2 className="mb-6 text-4xl font-bold tracking-tight text-neutral-900 md:text-5xl">
            Speak.{' '}
            <span className="bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
              It understands.
            </span>
          </h2>
          <p className="mb-6 text-lg leading-relaxed text-neutral-600">
            Eight action types. One interface. Send a WhatsApp voice note or text message.
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
                <Mic className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
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

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <div className="flex items-start gap-4 rounded-xl border border-neutral-100 bg-white p-6">
            <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-cyan-700">Chat Agent</p>
              <p className="mt-1 text-sm text-neutral-600">
                Your guide to the platform. Ask how anything works — the agent answers from up-to-date documentation with source citations. Guest access works without an account.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4 rounded-xl border border-neutral-100 bg-white p-6">
            <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-cyan-700">Data Insights</p>
              <p className="mt-1 text-sm text-neutral-600">
                Upload data files or combine them with captured mobile notifications. The AI discovers patterns and recommends chart types — no formulas, no spreadsheet gymnastics.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SelfBuildingSection(): React.JSX.Element {
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

function CouncilSection(): React.JSX.Element {
  const providers = [
    { name: 'ANTHROPIC', models: '3 models: reasoning, coding, speed', role: 'Analysis, validation, autonomous coding', icon: Brain },
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
            Four models debate.{' '}
            <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
              You get the truth.
            </span>
          </h2>
          <p className="max-w-2xl text-lg leading-relaxed text-neutral-400">
            Single-model assistants hallucinate. Even Perplexity queries one model at a time. IntexuraOS
            queries five and surfaces where they disagree. When three agree and two dissent, that
            disagreement is surfaced — not hidden. Every claim traces back to which model said it and why.
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
            the system choose. Every LLM call is tracked: model, tokens, cost. Full transparency.
          </p>
        </div>
      </div>
    </section>
  );
}

function IntegrationsSection(): React.JSX.Element {
  const integrations = [
    { name: 'WhatsApp', description: 'Mobile command center — voice notes, text, approvals', icon: Smartphone },
    { name: 'Google Calendar', description: 'Events from voice, previewed before creation', icon: Layers },
    { name: 'Linear', description: 'Project tracking with real-time board sync', icon: CheckCircle2 },
    { name: 'Notion', description: 'Export research reports as structured pages', icon: MessageSquare },
    { name: 'GitHub', description: 'PRs, code reviews, and feedback loops', icon: GitPullRequest },
    { name: 'Android', description: 'Notification capture for data insights', icon: Bell },
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

function WhatsNewSection(): React.JSX.Element {
  const features: {
    title: string;
    description: string;
    icon: React.ElementType;
    borderColor: string;
    bgGradient: string;
    iconBg: string;
    iconColor: string;
  }[] = [
    {
      title: 'GitHub Agent',
      description:
        'A new agent evaluates pull requests using tool calling, with a unified webhook evaluator routing GitHub events.',
      icon: GitPullRequest,
      borderColor: 'border-purple-200',
      bgGradient: 'bg-gradient-to-br from-purple-50 to-white',
      iconBg: 'bg-purple-100',
      iconColor: 'text-purple-700',
    },
    {
      title: 'Alibaba Cloud Model Studio',
      description:
        'Unified integration for Chinese LLMs — Qwen, Kimi, and GLM-5 — via Alibaba Cloud Model Studio.',
      icon: Globe,
      borderColor: 'border-cyan-200',
      bgGradient: 'bg-gradient-to-br from-cyan-50 to-white',
      iconBg: 'bg-cyan-100',
      iconColor: 'text-cyan-700',
    },
    {
      title: 'Code Task Detail V2',
      description:
        'Completely redesigned code task experience with a modern detail page and issue-centric grouped list.',
      icon: Code2,
      borderColor: 'border-emerald-200',
      bgGradient: 'bg-gradient-to-br from-emerald-50 to-white',
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-700',
    },
    {
      title: 'Unified PR Automation Log',
      description:
        'Every action taken on a pull request is now visible in a single, auditable automation log.',
      icon: ScrollText,
      borderColor: 'border-blue-200',
      bgGradient: 'bg-gradient-to-br from-blue-50 to-white',
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-700',
    },
    {
      title: 'Structured Output Validation',
      description:
        'GitHub Agent triage produces reliable results with automatic repair prompts for malformed output.',
      icon: Sparkles,
      borderColor: 'border-violet-200',
      bgGradient: 'bg-gradient-to-br from-violet-50 to-white',
      iconBg: 'bg-violet-100',
      iconColor: 'text-violet-700',
    },
    {
      title: 'Agent-Based Routing',
      description:
        'Requests automatically routed to the right specialist based on issue labels.',
      icon: Waypoints,
      borderColor: 'border-amber-200',
      bgGradient: 'bg-gradient-to-br from-amber-50 to-white',
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-700',
    },
    {
      title: 'One-Click Implement',
      description:
        'Planned tasks go from design to pull request with a single button press.',
      icon: Zap,
      borderColor: 'border-green-200',
      bgGradient: 'bg-gradient-to-br from-green-50 to-white',
      iconBg: 'bg-green-100',
      iconColor: 'text-green-700',
    },
    {
      title: 'Task Queueing',
      description:
        'New requests wait in line when workers are busy instead of being dropped.',
      icon: LayoutGrid,
      borderColor: 'border-rose-200',
      bgGradient: 'bg-gradient-to-br from-rose-50 to-white',
      iconBg: 'bg-rose-100',
      iconColor: 'text-rose-700',
    },
    {
      title: 'PR Comment Tasks',
      description:
        'Leave a comment on a pull request and a code task is created automatically.',
      icon: GitPullRequestArrow,
      borderColor: 'border-indigo-200',
      bgGradient: 'bg-gradient-to-br from-indigo-50 to-white',
      iconBg: 'bg-indigo-100',
      iconColor: 'text-indigo-700',
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
            v3.3.0 —{' '}
            <span className="bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
              9 new capabilities.
            </span>
          </h2>
          <p className="text-lg leading-relaxed text-neutral-600">
            GitHub Agent, Alibaba Cloud Model Studio, redesigned code tasks, and more.
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

function GettingStartedSection(): React.JSX.Element {
  return (
    <section className="bg-gradient-to-b from-cyan-50 to-white px-6 py-24">
      <div className="mx-auto max-w-4xl">
        <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-cyan-600">
          Getting Started
        </p>
        <h2 className="mb-6 text-4xl font-bold tracking-tight text-neutral-900 md:text-5xl">
          Three things.{' '}
          <span className="bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
            That&apos;s it.
          </span>
        </h2>
        <p className="mb-12 max-w-2xl text-lg leading-relaxed text-neutral-600">
          You need a WhatsApp account, a Google account, and a web browser. Everything else is optional.
        </p>

        <div className="grid gap-6 md:grid-cols-3">
          {[
            { num: '1', title: 'Sign Up', desc: 'Create an account through the web app. Link your Google account for calendar access.' },
            { num: '2', title: 'Connect WhatsApp', desc: 'Verify your phone number with a one-time code. Your mobile command center is ready.' },
            { num: '3', title: 'Send a Message', desc: 'Type or speak your first command. The platform provides fallback AI access for research, bookmarks, and chat — no API keys needed to start. Coding tasks use your own Anthropic subscription.' },
          ].map((step) => (
            <motion.div
              key={step.num}
              whileHover={{ y: -5 }}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm transition-all hover:shadow-md"
            >
              <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-cyan-700">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-100 font-bold text-cyan-700">
                  {step.num}
                </span>
                {step.title}
              </div>
              <p className="text-neutral-600">
                {step.desc}
              </p>
            </motion.div>
          ))}
        </div>

        <p className="mt-8 text-sm text-neutral-500">
          For coding tasks, connect a worker machine (any Mac or Linux computer). For project tracking, connect Linear. For research exports, connect Notion. Each integration is optional.
        </p>
      </div>
    </section>
  );
}

function LimitationsSection(): React.JSX.Element {
  const limitations = [
    'WhatsApp is the only mobile channel — no SMS, email, or native push',
    'WhatsApp 24-hour messaging policy — the system cannot reach you after a day of silence until you send the next message',
    'Google Calendar only — no Outlook or Apple Calendar',
    'Linear for project tracking — no Jira or Asana',
    'Android-only notification capture — iOS not supported',
    'English and Polish natively — other languages may work but are not tested',
    'Two worker machines (any Mac or Linux computer) maximum — a primary and a fallback',
    'Designed for individual use — no shared workspaces or team features',
    'Design review before code execution — a deliberate quality gate',
    'No recurring events or tasks — single instances only',
    'API keys configured manually — the system validates each before accepting',
  ];

  return (
    <section className="bg-white px-6 py-24">
      <div className="mx-auto max-w-4xl">
        <div className="mb-3 flex items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold uppercase tracking-wider text-amber-700">
            Deliberate Scope Decisions
          </p>
        </div>
        <h2 className="mb-6 text-4xl font-bold tracking-tight text-neutral-900 md:text-5xl">
          What this system does not do.
        </h2>
        <p className="mb-10 max-w-2xl text-lg leading-relaxed text-neutral-600">
          IntexuraOS is designed for individual power users who want depth in one workflow over breadth across many.
          These are deliberate scope decisions, not gaps on a roadmap.
        </p>

        <ul className="space-y-3">
          {limitations.map((limitation) => (
            <li key={limitation} className="flex items-start gap-3 text-neutral-600">
              <span className="mt-2 block h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-300" />
              {limitation}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function EngineeringSection(): React.JSX.Element {
  return (
    <section className="bg-neutral-50 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 max-w-2xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">
            Engineering Philosophy
          </p>
          <h2 className="mb-6 text-4xl font-bold tracking-tight text-neutral-900 md:text-5xl">
            Coverage is a gate.{' '}
            <span className="bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
              Not a target.
            </span>
          </h2>
          <p className="mb-6 text-lg leading-relaxed text-neutral-600">
            Every branch is tested or explicitly exempted. Every operation returns{' '}
            <code className="rounded bg-neutral-200 px-1.5 py-0.5 text-sm font-semibold">Result&lt;T, E&gt;</code>
            . No silent failures. No <code className="rounded bg-neutral-200 px-1.5 py-0.5 text-sm font-semibold">any</code> types.
            The compiler and the test suite are both gates that must pass before code ships.
          </p>
          <p className="text-sm leading-relaxed text-neutral-500">
            This section is for developers evaluating the engineering standards behind the platform.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <ModernCard title="Every Path Tested" icon={Shield}>
            <p className="text-neutral-600">
              100% branch coverage. CI fails on any unaccounted branch. Every exemption requires a category
              and justification. The test suite is the specification — if it passes, it works.
            </p>
          </ModernCard>
          <ModernCard title="The Compiler Is a Gate" icon={Layers}>
            <p className="text-neutral-600">
              Strict TypeScript catches what tests might miss:{' '}
              <code className="rounded bg-neutral-100 px-1 text-xs">noUncheckedIndexedAccess</code>,{' '}
              <code className="rounded bg-neutral-100 px-1 text-xs">exactOptionalPropertyTypes</code>,{' '}
              <code className="rounded bg-neutral-100 px-1 text-xs">strictBooleanExpressions</code>.
            </p>
          </ModernCard>
          <ModernCard title="Swap Any Part" icon={Layers}>
            <p className="text-neutral-600">
              Hexagonal architecture: domain logic is pure — no database imports, no HTTP frameworks.
              Firestore, WhatsApp, GitHub are just adapters. Swap any without touching business rules.
            </p>
          </ModernCard>
          <ModernCard title="Extreme Ownership" icon={Shield}>
            <p className="mb-3 text-neutral-600">
              Based on Jocko Willink&apos;s principles. CI failure = your problem. No &quot;other services
              failed&quot; rationalizations. Discovery creates ownership.
            </p>
            <a
              href="https://github.com/pbuchman/intexuraos/blob/main/docs/philosophy/extreme-ownership.md"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm font-semibold text-cyan-600 transition-colors hover:text-cyan-700"
            >
              Read Philosophy <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </ModernCard>
          <ModernCard title="AI-Native Development" icon={Bot}>
            <p className="text-neutral-600">
              AI isn&apos;t a feature — it&apos;s a team member. Custom skills for Linear issues, Sentry triage,
              documentation generation. Cross-linking between all artifacts is automatic.
            </p>
          </ModernCard>
          <ModernCard title="Infrastructure as Code" icon={Terminal}>
            <p className="text-neutral-600">
              Everything in Terraform. Cloud Run, Cloud Functions, Pub/Sub, IAM — reproducible, auditable,
              version-controlled. No manual console clicks.
            </p>
          </ModernCard>
        </div>
      </div>
    </section>
  );
}

function AboutSection(): React.JSX.Element {
  return (
    <section className="bg-neutral-950 px-6 py-24 text-white">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="mb-8 text-4xl font-bold tracking-tight md:text-5xl">
          One developer.{' '}
          <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
            Zero excuses.
          </span>
        </h2>
        <p className="mx-auto mb-8 max-w-2xl text-lg leading-relaxed text-neutral-400">
          IntexuraOS is what happens when a single engineer refuses to accept that one person can&apos;t
          build and maintain a 24-service distributed system (plus 22 shared packages) with enterprise-grade reliability.
          The answer isn&apos;t working harder. It&apos;s building agents that work for you — then building
          agents that build agents.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <a
            href="https://www.linkedin.com/in/piotrbuchman/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold transition-all hover:border-white/40 hover:bg-white/10"
          >
            <LinkedinIcon className="h-4 w-4" /> Piotr Buchman
          </a>
          <a
            href="https://github.com/pbuchman/intexuraos"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold transition-all hover:border-white/40 hover:bg-white/10"
          >
            <GithubIcon className="h-4 w-4" /> Source Code
          </a>
          <a
            href="https://github.com/pbuchman/intexuraos/blob/main/CHANGELOG.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold transition-all hover:border-white/40 hover:bg-white/10"
          >
            <ArrowRight className="h-4 w-4" /> Changelog
          </a>
        </div>
        <Link
          to="/login"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-cyan-600 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-600/20 transition-all hover:-translate-y-0.5 hover:bg-cyan-700"
        >
          Get Started <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function Footer(): React.JSX.Element {
  return (
    <footer className="border-t border-neutral-100 bg-white px-6 py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-cyan-600" />
          <span className="font-bold text-neutral-900">IntexuraOS</span>
          <span className="text-xs text-neutral-400">v3.3.0</span>
        </div>
        <p className="text-sm text-neutral-500">
          &copy; {new Date().getFullYear()}{' '}
          <a href="https://pbuchman.com" className="transition-colors hover:text-cyan-600">
            Piotr Buchman
          </a>
        </p>
        <div className="flex gap-6">
          <a
            href="https://github.com/pbuchman"
            className="text-neutral-400 transition-colors hover:text-neutral-900"
          >
            <GithubIcon className="h-5 w-5" />
          </a>
          <a
            href="https://linkedin.com/in/piotrbuchman"
            className="text-neutral-400 transition-colors hover:text-neutral-900"
          >
            <LinkedinIcon className="h-5 w-5" />
          </a>
        </div>
      </div>
    </footer>
  );
}

// --- Main Page ---

export function HomePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-white font-sans text-neutral-900 selection:bg-cyan-100 selection:text-cyan-900">
      <Navbar />
      <HeroSection />
      <StatsSection />
      <VoiceSection />
      <SelfBuildingSection />
      <CouncilSection />
      <IntegrationsSection />
      <WhatsNewSection />
      <GettingStartedSection />
      <LimitationsSection />
      <EngineeringSection />
      <AboutSection />
      <Footer />
    </div>
  );
}
