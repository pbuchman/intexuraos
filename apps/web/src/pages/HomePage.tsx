import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Bot,
  Brain,
  CheckCircle2,
  Clock,
  Code2,
  Container,
  Eye,
  GitPullRequest,
  Layers,
  Lock,
  Mail,
  MessageSquare,
  Mic,
  Shield,
  Smartphone,
  Terminal,
  Zap,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';

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

// --- Reusable Components ---

function BrutalistCard({
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
    <div
      className={`relative border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] transition-transform hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.15)] ${className}`}
    >
      {title && (
        <div className="mb-4 flex items-center gap-3 border-b-2 border-black dark:border-white/20 pb-3">
          {Icon && <Icon className="h-6 w-6 stroke-[2.5px] dark:text-white" />}
          <h3 className="font-mono text-lg font-bold uppercase tracking-tight dark:text-white">{title}</h3>
        </div>
      )}
      {children}
    </div>
  );
}

// --- Terminal Animation ---

const TERMINAL_LINES = [
  { text: '$ voice note: "Dentist next Tuesday at 3pm"', delay: 0, color: 'text-green-400' },
  { text: '  → Transcribing voice note...', delay: 800, color: 'text-neutral-400' },
  { text: '  → Intent classified: calendar (confidence: 0.94)', delay: 1600, color: 'text-cyan-400' },
  { text: '  → Calendar Agent: building event preview...', delay: 2400, color: 'text-purple-400' },
  { text: '  → Preview: "Dentist" — Tue Mar 3, 3:00 PM (1h)', delay: 3200, color: 'text-yellow-400' },
  { text: '  → WhatsApp: [Approve] [Edit] sent ✓', delay: 4000, color: 'text-blue-400' },
  { text: '  → User tapped: Approve', delay: 5200, color: 'text-green-400' },
  { text: '  → Google Calendar event created ✓', delay: 6200, color: 'text-emerald-400' },
  { text: '  → WhatsApp: "Dentist added to your calendar" ✓', delay: 7200, color: 'text-green-300' },
];

function AnimatedTerminal(): React.JSX.Element {
  const [visibleLines, setVisibleLines] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const [index, line] of TERMINAL_LINES.entries()) {
      const timer = setTimeout(() => {
        setVisibleLines(index + 1);
      }, line.delay);
      timers.push(timer);
    }

    const resetTimer = setTimeout(() => {
      setVisibleLines(0);
      // Restart the animation
      const restartTimer = setTimeout(() => {
        for (const [index, line] of TERMINAL_LINES.entries()) {
          const timer = setTimeout(() => {
            setVisibleLines(index + 1);
          }, line.delay);
          timers.push(timer);
        }
      }, 500);
      timers.push(restartTimer);
    }, 10000);
    timers.push(resetTimer);

    return (): void => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [visibleLines]);

  return (
    <div className="overflow-hidden rounded-none border-2 border-black dark:border-white/20 bg-neutral-950 font-mono text-sm shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,0.1)]">
      <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-4 py-2">
        <div className="h-3 w-3 rounded-full bg-red-500" />
        <div className="h-3 w-3 rounded-full bg-yellow-500" />
        <div className="h-3 w-3 rounded-full bg-green-500" />
        <span className="ml-2 text-xs text-neutral-500">intexuraos — voice to action</span>
      </div>
      <div className="p-4 md:p-6">
        <div className="space-y-1">
          {TERMINAL_LINES.slice(0, visibleLines).map((line, i) => (
            <div
              key={i}
              className={`${line.color} transition-opacity duration-300`}
            >
              {line.text}
              {i === visibleLines - 1 && <span className="animate-pulse">▊</span>}
            </div>
          ))}
          {visibleLines === 0 && (
            <div className="text-green-400">
              <span className="animate-pulse">▊</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Stat Counter ---

function StatBlock({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <div className="text-center">
      <div className="text-4xl font-black tracking-tighter md:text-5xl">{value}</div>
      <div className="mt-1 font-mono text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
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
    <div className="group relative">
      <div className={`mb-4 inline-flex items-center gap-3 border-2 border-black dark:border-white/20 ${accent} px-4 py-2 font-mono text-sm font-bold uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,0.1)]`}>
        <Icon className="h-4 w-4" />
        {number}
      </div>
      <h3 className="mb-2 text-xl font-black uppercase tracking-tight dark:text-white">{title}</h3>
      <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed">{description}</p>
    </div>
  );
}

// --- Sections ---

function HeroSection(): React.JSX.Element {
  return (
    <section className="relative flex min-h-[95vh] flex-col justify-center border-b-4 border-black dark:border-white/10 bg-gradient-to-br from-cyan-50 via-white to-blue-50 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900 px-6 py-24">
      <div className="mx-auto w-full max-w-7xl">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center">
          <div>
            <div className="mb-6 flex flex-wrap gap-3">
              <a
                href="https://www.linkedin.com/in/piotrbuchman/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 px-3 py-1.5 font-mono text-xs font-bold uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,0.1)] transition-all hover:-translate-y-0.5 dark:text-white"
              >
                <LinkedinIcon className="h-3.5 w-3.5" /> LinkedIn
              </a>
              <a
                href="https://github.com/pbuchman/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 px-3 py-1.5 font-mono text-xs font-bold uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,0.1)] transition-all hover:-translate-y-0.5 dark:text-white"
              >
                <GithubIcon className="h-3.5 w-3.5" /> GitHub
              </a>
              <a
                href="mailto:kontakt@pbuchman.com"
                className="inline-flex items-center gap-2 border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 px-3 py-1.5 font-mono text-xs font-bold uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,0.1)] transition-all hover:-translate-y-0.5 dark:text-white"
              >
                <Mail className="h-3.5 w-3.5" /> Email
              </a>
            </div>

            <p className="mb-3 font-mono text-sm font-bold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-400">
              IntexuraOS v3.1.0
            </p>

            <p className="mb-4 max-w-xl text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
              You remember the bug while walking to lunch. You think of a research question on the commute home.
              You are not at a keyboard.
            </p>

            <h1 className="mb-8 text-5xl font-black uppercase leading-[0.9] tracking-tighter text-black dark:text-white md:text-7xl lg:text-[5.5rem]">
              Say it.{' '}
              <span className="bg-cyan-600 px-2 text-white dark:bg-cyan-500">It</span>
              <br />
              happens.
            </h1>

            <p className="mb-4 max-w-xl text-xl leading-relaxed text-neutral-700 dark:text-neutral-300">
              Send a WhatsApp voice note while walking. Come back to a calendar event created,
              research synthesized from five AI models, code written and tested, project
              task tracked. This is not a convenience shortcut to a desktop workflow.
              It is a fundamentally different interaction model.
            </p>

            <p className="mb-10 max-w-xl text-lg font-bold leading-relaxed text-neutral-600 dark:text-neutral-400">
              ChatGPT voice gives you an answer. IntexuraOS gives you a calendar event, a pull request, or a research report.
            </p>

            <div className="flex flex-col gap-4 sm:flex-row">
              <Link
                to="/login"
                className="group flex items-center justify-center gap-2 border-2 border-black bg-cyan-600 px-8 py-4 text-lg font-bold text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-1 hover:bg-cyan-700 hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
              >
                LOG IN <Terminal className="h-5 w-5" />
              </Link>
              <a
                href="https://github.com/pbuchman/intexuraos"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-center gap-2 border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 px-8 py-4 text-lg font-bold text-black dark:text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] transition-all hover:-translate-y-1 hover:bg-neutral-100 dark:hover:bg-slate-700"
              >
                VIEW SOURCE <GithubIcon className="h-5 w-5" />
              </a>
            </div>
            <p className="mt-4 font-mono text-xs text-neutral-500 dark:text-neutral-500">
              New here? Signing up takes 2 minutes. The login page handles both.
            </p>
          </div>

          <div className="hidden lg:block">
            <AnimatedTerminal />
          </div>
        </div>

        <div className="mt-12 lg:hidden">
          <AnimatedTerminal />
        </div>
      </div>
    </section>
  );
}

function StatsSection(): React.JSX.Element {
  return (
    <section className="border-b-4 border-black dark:border-white/10 bg-white dark:bg-slate-900 px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <p className="mb-8 text-center font-mono text-sm font-bold uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">
          Built for one person. Not a team tool.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-8 text-black dark:text-white">
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

function SelfBuildingSection(): React.JSX.Element {
  return (
    <section className="border-b-4 border-black dark:border-white/10 bg-neutral-50 dark:bg-slate-950 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <p className="mb-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-400">
          The Self-Building System
        </p>
        <h2 className="mb-6 max-w-3xl text-4xl font-black uppercase leading-[0.95] tracking-tighter text-black dark:text-white md:text-6xl">
          Describe the change. <br />
          Receive a pull request.
        </h2>
        <p className="mb-6 max-w-2xl text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
          Most AI coding tools wait for you to sit at a keyboard. IntexuraOS doesn&apos;t. You describe
          what needs to change — while walking, while commuting, wherever the idea hits.
          The platform designs the approach, writes the code in a sealed container on your
          machine, runs the full test suite, creates a code change for review, and updates the
          project issue. If verification fails, it retries with preserved context.
        </p>
        <p className="mb-8 max-w-2xl text-sm leading-relaxed text-neutral-500 dark:text-neutral-500 font-mono">
          24 services communicate over authenticated HTTP. No shared databases. Each service owns its data.
        </p>

        <div className="mb-16 grid gap-6 md:grid-cols-2">
          <div className="border-2 border-black dark:border-white/20 bg-cyan-50 dark:bg-cyan-950/30 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)]">
            <div className="mb-3 flex items-center gap-3 border-b-2 border-black dark:border-white/20 pb-3">
              <Lock className="h-6 w-6 stroke-[2.5px] dark:text-white" />
              <h3 className="font-mono text-lg font-bold uppercase tracking-tight dark:text-white">Your Code Never Leaves Your Network</h3>
            </div>
            <p className="text-neutral-600 dark:text-neutral-400">
              Cursor and Copilot send your code to the cloud. IntexuraOS runs on your machine, inside
              isolated containers, powered by your own AI subscription. Your source code stays where it belongs.
            </p>
          </div>
          <div className="border-2 border-black dark:border-white/20 bg-emerald-50 dark:bg-emerald-950/30 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)]">
            <div className="mb-3 flex items-center gap-3 border-b-2 border-black dark:border-white/20 pb-3">
              <Eye className="h-6 w-6 stroke-[2.5px] dark:text-white" />
              <h3 className="font-mono text-lg font-bold uppercase tracking-tight dark:text-white">You Approve Before It Runs</h3>
            </div>
            <p className="text-neutral-600 dark:text-neutral-400">
              You approve the design before code runs. Calendar events before they are created.
              High-stakes actions before they execute. You stay in control without becoming a bottleneck.
            </p>
          </div>
        </div>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          <PipelineStep
            number="Phase 1"
            title="Design"
            description="A design agent analyzes the task, enriches the project issue with technical context, creates subissues for complex work, and labels it code-task when the plan is sound."
            icon={Brain}
            accent="bg-purple-100 dark:bg-purple-900/40 dark:text-purple-300"
          />
          <PipelineStep
            number="Phase 2"
            title="Execute"
            description="A strict execution agent picks up the labeled issue, writes code in an isolated container on your machine, runs the full test suite, and creates a code change for review."
            icon={Code2}
            accent="bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300"
          />
          <PipelineStep
            number="Verify"
            title="Check"
            description="An independent verifier checks the work against completion criteria: correct files modified, tests passing, code change created. If not, the system resumes automatically."
            icon={CheckCircle2}
            accent="bg-green-100 dark:bg-green-900/40 dark:text-green-300"
          />
          <PipelineStep
            number="Deliver"
            title="Ship"
            description="Code change created, project issue moved to In Review, WhatsApp notification sent. You review and merge when ready. The platform did the rest."
            icon={GitPullRequest}
            accent="bg-cyan-100 dark:bg-cyan-900/40 dark:text-cyan-300"
          />
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          <BrutalistCard title="No Task Sees Another" icon={Container}>
            <p className="text-neutral-600 dark:text-neutral-400">
              Two concurrent tasks never see each other&apos;s files, messages, or credentials.
              Each runs in its own sealed container with restricted permissions.
            </p>
          </BrutalistCard>
          <BrutalistCard title="Tamper-Proof Delivery" icon={Shield}>
            <p className="text-neutral-600 dark:text-neutral-400">
              Your conversations and code cannot be intercepted or seen by other tasks.
              All communication between services is cryptographically signed, timestamped, and
              delivered through a private tunnel. No exposed endpoints.
            </p>
          </BrutalistCard>
          <BrutalistCard title="Automatic Retry" icon={Zap}>
            <p className="text-neutral-600 dark:text-neutral-400">
              Failed tasks preserve full context and retry with a 1-minute cool-off. Messages queue
              during execution and trigger resume on completed tasks.
            </p>
          </BrutalistCard>
        </div>
      </div>
    </section>
  );
}

function CouncilSection(): React.JSX.Element {
  const providers = [
    { name: 'ANTHROPIC', models: '3 models: reasoning, coding, speed', role: 'Analysis, validation, autonomous coding', color: 'border-orange-500/50' },
    { name: 'OPENAI', models: '4 models: research, reasoning, images', role: 'Deep research, synthesis, embeddings', color: 'border-green-500/50' },
    { name: 'GOOGLE', models: '4 models: analysis, classification, images', role: 'Classification, routing, image gen', color: 'border-blue-500/50' },
    { name: 'PERPLEXITY', models: '3 models: search, synthesis, deep dive', role: 'Real-time web search, citations', color: 'border-purple-500/50' },
    { name: 'ZAI', models: '2 models: multilingual, fast', role: 'Multilingual, cost-efficient, guest access', color: 'border-cyan-500/50' },
  ];

  return (
    <section className="border-b-4 border-black dark:border-white/10 bg-neutral-950 px-6 py-24 text-white">
      <div className="mx-auto max-w-7xl">
        <p className="mb-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-neutral-500">
          The Council of AI
        </p>
        <h2 className="mb-6 max-w-3xl text-4xl font-black uppercase leading-[0.95] tracking-tighter md:text-6xl">
          Five models debate. <br />
          You get the truth.
        </h2>
        <p className="mb-16 max-w-2xl text-lg leading-relaxed text-neutral-400">
          Single-model assistants hallucinate. Even Perplexity queries one model at a time. IntexuraOS
          queries five and surfaces where they disagree. When three agree and two dissent, that
          disagreement is surfaced — not hidden. Every claim traces back to which model said it and why.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {providers.map((provider) => (
            <div
              key={provider.name}
              className={`flex flex-col border-2 ${provider.color} bg-neutral-900/50 p-6 transition-all hover:bg-neutral-800/80 hover:border-white/40`}
            >
              <div className="mb-3 text-xl font-black tracking-tight">{provider.name}</div>
              <div className="mb-2 font-mono text-xs leading-relaxed text-neutral-400">{provider.models}</div>
              <div className="mt-auto font-mono text-xs text-neutral-600">{provider.role}</div>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-neutral-800 pt-8">
          <p className="font-mono text-sm text-neutral-500">
            Specify models in natural language: &quot;Research AI trends with Claude and GPT&quot; — or let
            the system choose. Every LLM call is tracked: model, tokens, cost. Full transparency.
          </p>
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
    <section className="border-b-4 border-black dark:border-white/10 bg-gradient-to-br from-cyan-50 to-blue-50 dark:from-slate-900 dark:to-slate-950 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <p className="mb-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-400">
          Voice-First Intelligence
        </p>
        <h2 className="mb-6 max-w-3xl text-4xl font-black uppercase leading-[0.95] tracking-tighter text-black dark:text-white md:text-6xl">
          Speak. <br />
          It understands.
        </h2>
        <p className="mb-6 max-w-2xl text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
          Eight action types. One interface. Send a WhatsApp voice note or text message.
          The system figures out what you meant — even when the wording is imprecise — and
          routes it to the right specialist. Polish and English supported.
        </p>
        <p className="mb-16 max-w-2xl text-sm leading-relaxed text-neutral-500 dark:text-neutral-500 font-mono">
          This is not one AI that tries to do everything. It is 24 services, each built for a single domain.
        </p>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {actions.map((action) => (
            <div
              key={action.tag}
              className="group border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] transition-all hover:-translate-y-1"
            >
              <div className="mb-3 flex items-center gap-2">
                <action.icon className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                <span className="font-mono text-xs font-bold tracking-wider text-cyan-700 dark:text-cyan-400">
                  {action.tag}
                </span>
              </div>
              <div className="mb-3 flex items-start gap-2">
                <Mic className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                <p className="text-sm font-bold italic text-black dark:text-white">
                  &quot;{action.input}&quot;
                </p>
              </div>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                → {action.output}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <div className="flex items-start gap-4 border-t-2 border-black/10 dark:border-white/10 pt-6">
            <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-400" />
            <div>
              <p className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-400">Chat Agent</p>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                Your guide to the platform. Ask how anything works — the agent answers from up-to-date documentation with source citations. Guest access works without an account.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4 border-t-2 border-black/10 dark:border-white/10 pt-6">
            <Zap className="mt-0.5 h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-400" />
            <div>
              <p className="font-mono text-xs font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-400">Data Insights</p>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                Upload data files or combine them with captured mobile notifications. The AI discovers patterns and recommends chart types — no formulas, no spreadsheet gymnastics.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function EngineeringSection(): React.JSX.Element {
  return (
    <section className="border-b-4 border-black dark:border-white/10 bg-white dark:bg-slate-900 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <p className="mb-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">
          Engineering Philosophy
        </p>
        <h2 className="mb-6 max-w-3xl text-4xl font-black uppercase leading-[0.95] tracking-tighter text-black dark:text-white md:text-6xl">
          Coverage is a gate. <br />
          Not a target.
        </h2>
        <p className="mb-6 max-w-2xl text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
          Every branch is tested or explicitly exempted. Every operation returns{' '}
          <code className="bg-neutral-100 dark:bg-slate-800 px-1.5 py-0.5 text-sm font-bold">Result&lt;T, E&gt;</code>
          . No silent failures. No <code className="bg-neutral-100 dark:bg-slate-800 px-1.5 py-0.5 text-sm font-bold">any</code> types.
          The compiler and the test suite are both gates that must pass before code ships.
        </p>
        <p className="mb-16 max-w-2xl text-sm leading-relaxed text-neutral-500 dark:text-neutral-500 font-mono">
          This section is for developers evaluating the engineering standards behind the platform.
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <BrutalistCard title="Every Path Tested" icon={Shield}>
            <p className="text-neutral-600 dark:text-neutral-400">
              100% branch coverage. CI fails on any unaccounted branch. Every exemption requires a category
              and justification. The test suite is the specification — if it passes, it works.
            </p>
          </BrutalistCard>
          <BrutalistCard title="The Compiler Is a Gate" icon={Layers}>
            <p className="text-neutral-600 dark:text-neutral-400">
              Strict TypeScript catches what tests might miss:{' '}
              <code className="text-xs">noUncheckedIndexedAccess</code>,{' '}
              <code className="text-xs">exactOptionalPropertyTypes</code>,{' '}
              <code className="text-xs">strictBooleanExpressions</code>.
            </p>
          </BrutalistCard>
          <BrutalistCard title="Swap Any Part" icon={Layers}>
            <p className="text-neutral-600 dark:text-neutral-400">
              Hexagonal architecture: domain logic is pure — no database imports, no HTTP frameworks.
              Firestore, WhatsApp, GitHub are just adapters. Swap any without touching business rules.
            </p>
          </BrutalistCard>
          <BrutalistCard title="Extreme Ownership" icon={Shield}>
            <p className="text-neutral-600 dark:text-neutral-400 mb-3">
              Based on Jocko Willink&apos;s principles. CI failure = your problem. No &quot;other services
              failed&quot; rationalizations. Discovery creates ownership.
            </p>
            <a
              href="https://github.com/pbuchman/intexuraos/blob/main/docs/philosophy/extreme-ownership.md"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 font-mono text-xs font-bold text-cyan-700 dark:text-cyan-400 hover:underline"
            >
              Read Philosophy <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </BrutalistCard>
          <BrutalistCard title="AI-Native Development" icon={Bot}>
            <p className="text-neutral-600 dark:text-neutral-400">
              AI isn&apos;t a feature — it&apos;s a team member. Custom skills for Linear issues, Sentry triage,
              documentation generation. Cross-linking between all artifacts is automatic.
            </p>
          </BrutalistCard>
          <BrutalistCard title="Infrastructure as Code" icon={Terminal}>
            <p className="text-neutral-600 dark:text-neutral-400">
              Everything in Terraform. Cloud Run, Cloud Functions, Pub/Sub, IAM — reproducible, auditable,
              version-controlled. No manual console clicks.
            </p>
          </BrutalistCard>
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
    <section className="border-b-4 border-black dark:border-white/10 bg-white dark:bg-slate-900 px-6 py-16">
      <div className="mx-auto max-w-7xl">
        <p className="mb-8 text-center font-mono text-sm font-bold uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">
          Connected Services
        </p>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {integrations.map((integration) => (
            <div key={integration.name} className="flex flex-col items-center border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 p-4 text-center shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_0px_rgba(255,255,255,0.1)]">
              <integration.icon className="mb-2 h-6 w-6 text-cyan-600 dark:text-cyan-400" />
              <div className="font-mono text-xs font-bold uppercase tracking-wide dark:text-white">{integration.name}</div>
              <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{integration.description}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function GettingStartedSection(): React.JSX.Element {
  return (
    <section className="border-b-4 border-black dark:border-white/10 bg-gradient-to-br from-cyan-50 to-blue-50 dark:from-slate-900 dark:to-slate-950 px-6 py-24">
      <div className="mx-auto max-w-4xl">
        <p className="mb-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-400">
          Getting Started
        </p>
        <h2 className="mb-6 text-4xl font-black uppercase leading-[0.95] tracking-tighter text-black dark:text-white md:text-6xl">
          Three things. <br />
          That&apos;s it.
        </h2>
        <p className="mb-12 max-w-2xl text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
          You need a WhatsApp account, a Google account, and a web browser. Everything else is optional.
        </p>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)]">
            <div className="mb-3 inline-flex items-center gap-2 font-mono text-sm font-bold text-cyan-700 dark:text-cyan-400">
              <span className="flex h-8 w-8 items-center justify-center border-2 border-black dark:border-white/20 bg-cyan-100 dark:bg-cyan-900/40 font-black">1</span>
              Sign Up
            </div>
            <p className="text-neutral-600 dark:text-neutral-400">
              Create an account through the web app. Link your Google account for calendar access.
            </p>
          </div>
          <div className="border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)]">
            <div className="mb-3 inline-flex items-center gap-2 font-mono text-sm font-bold text-cyan-700 dark:text-cyan-400">
              <span className="flex h-8 w-8 items-center justify-center border-2 border-black dark:border-white/20 bg-cyan-100 dark:bg-cyan-900/40 font-black">2</span>
              Connect WhatsApp
            </div>
            <p className="text-neutral-600 dark:text-neutral-400">
              Verify your phone number with a one-time code. Your mobile command center is ready.
            </p>
          </div>
          <div className="border-2 border-black dark:border-white/20 bg-white dark:bg-slate-800 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)]">
            <div className="mb-3 inline-flex items-center gap-2 font-mono text-sm font-bold text-cyan-700 dark:text-cyan-400">
              <span className="flex h-8 w-8 items-center justify-center border-2 border-black dark:border-white/20 bg-cyan-100 dark:bg-cyan-900/40 font-black">3</span>
              Send a Message
            </div>
            <p className="text-neutral-600 dark:text-neutral-400">
              Type or speak your first command. The platform provides fallback AI access for research, bookmarks, and chat — no API keys needed to start. Coding tasks use your own Anthropic subscription.
            </p>
          </div>
        </div>

        <p className="mt-8 font-mono text-sm text-neutral-500 dark:text-neutral-500">
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
    <section className="border-b-4 border-black dark:border-white/10 bg-neutral-50 dark:bg-slate-950 px-6 py-24">
      <div className="mx-auto max-w-4xl">
        <div className="mb-3 flex items-center gap-3">
          <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          <p className="font-mono text-sm font-bold uppercase tracking-[0.2em] text-amber-700 dark:text-amber-400">
            Deliberate Scope Decisions
          </p>
        </div>
        <h2 className="mb-6 text-4xl font-black uppercase leading-[0.95] tracking-tighter text-black dark:text-white md:text-5xl">
          What this system does not do.
        </h2>
        <p className="mb-10 max-w-2xl text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
          IntexuraOS is designed for individual power users who want depth in one workflow over breadth across many.
          These are deliberate scope decisions, not gaps on a roadmap.
        </p>

        <ul className="space-y-3">
          {limitations.map((limitation) => (
            <li key={limitation} className="flex items-start gap-3 text-neutral-600 dark:text-neutral-400">
              <span className="mt-1.5 block h-2 w-2 shrink-0 border border-neutral-400 dark:border-neutral-600 bg-neutral-200 dark:bg-neutral-800" />
              {limitation}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function AboutSection(): React.JSX.Element {
  return (
    <section className="border-b-4 border-black dark:border-white/10 bg-neutral-950 px-6 py-24 text-white">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="mb-8 text-4xl font-black uppercase tracking-tighter md:text-6xl">
          One developer. <br />
          Zero excuses.
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
            className="inline-flex items-center gap-2 border-2 border-white/20 bg-white/5 px-6 py-3 font-mono text-sm font-bold uppercase transition-all hover:bg-white/10 hover:border-white/40"
          >
            <LinkedinIcon className="h-4 w-4" /> Piotr Buchman
          </a>
          <a
            href="https://github.com/pbuchman/intexuraos"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 border-2 border-white/20 bg-white/5 px-6 py-3 font-mono text-sm font-bold uppercase transition-all hover:bg-white/10 hover:border-white/40"
          >
            <GithubIcon className="h-4 w-4" /> Source Code
          </a>
          <a
            href="https://github.com/pbuchman/intexuraos/blob/main/CHANGELOG.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 border-2 border-white/20 bg-white/5 px-6 py-3 font-mono text-sm font-bold uppercase transition-all hover:bg-white/10 hover:border-white/40"
          >
            <ArrowRight className="h-4 w-4" /> Changelog
          </a>
        </div>
        <Link to="/login" className="mt-8 inline-flex items-center gap-2 border-2 border-cyan-500 bg-cyan-600 px-8 py-3 font-mono text-sm font-bold uppercase text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] transition-all hover:-translate-y-0.5 hover:bg-cyan-700">
          Get Started <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function Footer(): React.JSX.Element {
  return (
    <footer className="bg-white dark:bg-slate-900 px-6 py-12">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 md:flex-row md:items-center">
        <div>
          <h3 className="mb-1 text-2xl font-black uppercase tracking-tighter dark:text-white">IntexuraOS</h3>
          <p className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
            Say it. It happens. v3.1.0
          </p>
        </div>
        <p className="font-mono text-xs text-neutral-400">
          &copy; {new Date().getFullYear()}{' '}
          <a href="https://pbuchman.com" className="hover:text-cyan-600 dark:hover:text-cyan-400">
            Piotr Buchman
          </a>
        </p>
      </div>
    </footer>
  );
}

// --- Main Page ---

export function HomePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-neutral-100 dark:bg-slate-950 font-sans text-black dark:text-white selection:bg-cyan-200 selection:text-black dark:selection:bg-cyan-800 dark:selection:text-white">
      <HeroSection />
      <StatsSection />
      <VoiceSection />
      <SelfBuildingSection />
      <CouncilSection />
      <IntegrationsSection />
      <GettingStartedSection />
      <LimitationsSection />
      <EngineeringSection />
      <AboutSection />
      <Footer />
    </div>
  );
}
