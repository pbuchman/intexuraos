import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Brain,
  CheckSquare,
  Database,
  FileText,
  Mail,
  Layers,
  Mic,
  Shield,
  Terminal,
  Zap,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';

// Custom icons since lucide-react brand icons are deprecated
function LinkedinIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function GithubIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

// --- Components ---

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
      className={`relative border-2 border-black bg-white p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] ${className}`}
    >
      {title && (
        <div className="mb-4 flex items-center gap-3 border-b-2 border-black pb-3">
          {Icon && <Icon className="h-6 w-6 stroke-[2.5px]" />}
          <h3 className="font-mono text-lg font-bold uppercase tracking-tight">{title}</h3>
        </div>
      )}
      {children}
    </div>
  );
}

function SectionHeading({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <h2
      className={`mb-12 text-4xl font-black uppercase tracking-tighter md:text-6xl ${className}`}
    >
      {children}
    </h2>
  );
}

// --- Sections ---

function HeroSection(): React.JSX.Element {
  return (
    <section className="relative flex min-h-[90vh] flex-col justify-center border-b-4 border-black bg-yellow-400 px-6 py-24 pattern-dots pattern-black pattern-bg-transparent pattern-size-4 pattern-opacity-10">
      <div className="mx-auto w-full max-w-7xl">
        <div className="max-w-4xl">
          <div className="mb-6 flex flex-wrap gap-3">
            <a
              href="https://www.linkedin.com/in/piotrbuchman/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 border-2 border-black bg-white px-4 py-2 font-mono text-sm font-bold uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]"
            >
              <LinkedinIcon className="h-4 w-4" /> LinkedIn
            </a>
            <a
              href="https://github.com/pbuchman/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 border-2 border-black bg-white px-4 py-2 font-mono text-sm font-bold uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]"
            >
              <GithubIcon className="h-4 w-4" /> GitHub
            </a>
            <a
              href="mailto:kontakt@pbuchman.com"
              className="inline-flex items-center gap-2 border-2 border-black bg-white px-4 py-2 font-mono text-sm font-bold uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]"
            >
              <Mail className="h-4 w-4" /> Email
            </a>
          </div>
          <p className="mb-4 font-mono text-sm font-bold uppercase tracking-widest text-neutral-700">
            The AI-Native Personal Operating System
          </p>
          <h1 className="mb-8 text-6xl font-black uppercase leading-[0.9] tracking-tighter text-black md:text-8xl lg:text-[7rem]">
            Your brain is for <span className="bg-white px-2 text-black">thinking</span>
            <br /> not remembering.
          </h1>
          <p className="mb-10 max-w-2xl text-xl font-medium leading-relaxed text-neutral-900 md:text-2xl">
            IntexuraOS transforms fragmented information into structured intelligence. A council of
            16 AI models across 5 providers works autonomously — you remain the commander.
          </p>

          <div className="flex flex-col gap-4 sm:flex-row">
            <Link
              to="/login"
              className="group flex items-center justify-center gap-2 border-2 border-black bg-black px-8 py-4 text-lg font-bold text-white shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] transition-all hover:-translate-y-1 hover:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)]"
            >
              LOG IN <Terminal className="h-5 w-5" />
            </Link>
            <a
              href="https://github.com/pbuchman/intexuraos"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-center gap-2 border-2 border-black bg-white px-8 py-4 text-lg font-bold text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-y-1 hover:bg-neutral-100 hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
            >
              VIEW SOURCE CODE <GithubIcon className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function DemoSection(): React.JSX.Element {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((prev) => (prev + 1) % 4);
    }, 2000);
    return (): void => {
      clearInterval(timer);
    };
  }, []);

  return (
    <section className="border-b-4 border-black bg-white px-6 py-24">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2">
        <div className="flex flex-col justify-center">
          <SectionHeading>
            The Loop: <br />
            <span className="text-cyan-600">Capture</span> → <br />
            <span className="text-purple-600">Classify</span> → <br />
            <span className="text-green-600">Execute</span>
          </SectionHeading>
          <p className="text-xl font-medium text-neutral-600">
            18 specialized microservices route your intent to the right agent. Voice note becomes
            research report. Link becomes summarized bookmark. Date mention becomes calendar event.
          </p>
        </div>

        <div className="relative aspect-square max-h-[600px] w-full border-4 border-black bg-neutral-100 p-8 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
          {/* Step 1: Voice Input */}
          <div
            className={`absolute left-8 top-8 w-[80%] border-2 border-black bg-white p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all duration-500 ${
              step >= 0 ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'
            }`}
          >
            <div className="mb-2 flex items-center gap-2 font-mono text-sm font-bold text-neutral-500">
              <Mic className="h-4 w-4" /> USER INPUT (WHATSAPP)
            </div>
            <p className="text-lg font-bold italic">
              "Research the latest Hexagonal Architecture patterns and schedule a review meeting for
              Friday."
            </p>
          </div>

          {/* Step 2: Synthesis */}
          <div
            className={`absolute right-8 top-1/3 w-[80%] border-2 border-black bg-purple-100 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all duration-500 ${
              step >= 1 ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
            }`}
          >
            <div className="mb-2 flex items-center gap-2 font-mono text-sm font-bold text-purple-700">
              <Brain className="h-4 w-4" /> COUNCIL OF AI
            </div>
            <div className="space-y-2 font-mono text-sm">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" /> Intent: Research + Calendar
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" /> Agents: ResearchAgent,
                CalendarAgent
              </div>
            </div>
          </div>

          {/* Step 3: Execution */}
          <div
            className={`absolute bottom-8 left-8 w-[90%] border-2 border-black bg-green-100 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all duration-500 ${
              step >= 2 ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
            }`}
          >
            <div className="mb-2 flex items-center gap-2 font-mono text-sm font-bold text-green-700">
              <CheckSquare className="h-4 w-4" /> EXECUTION LOG
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3 border border-black/10 bg-white p-2">
                <Database className="h-4 w-4 text-neutral-400" />
                <span className="font-mono text-xs font-bold">NOTION</span>
                <span className="text-sm">Created page "Hexagonal Arch Research"</span>
              </div>
              <div className="flex items-center gap-3 border border-black/10 bg-white p-2">
                <Layers className="h-4 w-4 text-neutral-400" />
                <span className="font-mono text-xs font-bold">CALENDAR</span>
                <span className="text-sm">Event created: "Arch Review" (Fri 2PM)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CouncilSection(): React.JSX.Element {
  return (
    <section className="border-b-4 border-black bg-neutral-950 px-6 py-24 text-white">
      <div className="mx-auto max-w-7xl text-center">
        <h2 className="mb-6 font-mono text-3xl font-bold uppercase tracking-widest text-neutral-500">
          The Council of AI
        </h2>
        <p className="mx-auto mb-16 max-w-2xl text-lg text-neutral-400">
          16 models across 5 providers, treated as a council of experts rather than a single oracle.
          Each query is dispatched to multiple models in parallel, then synthesized with confidence
          scoring.
        </p>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { name: 'ANTHROPIC', models: 'Opus 4.5, Sonnet 4.5', role: 'Analysis & Validation' },
            { name: 'OPENAI', models: 'GPT-5.2, o4-mini', role: 'Deep Research & Images' },
            { name: 'GOOGLE', models: 'Gemini 2.5 Pro/Flash', role: 'Classification & Routing' },
            { name: 'PERPLEXITY', models: 'Sonar Pro/Deep', role: 'Real-time Web Search' },
            { name: 'ZAI', models: 'GLM-4.7 / Flash', role: 'Multilingual Analysis' },
          ].map((provider) => (
            <div
              key={provider.name}
              className="flex flex-col items-center justify-center border-2 border-neutral-800 p-6 transition-colors hover:border-white hover:bg-neutral-900"
            >
              <div className="mb-2 text-2xl font-black">{provider.name}</div>
              <div className="mb-2 font-mono text-xs text-neutral-400">{provider.models}</div>
              <div className="font-mono text-xs text-neutral-500">{provider.role}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ManifestoSection(): React.JSX.Element {
  return (
    <section className="border-b-4 border-black bg-cyan-400 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-16 lg:grid-cols-2">
          <div>
            <SectionHeading>Intelligence as Infrastructure</SectionHeading>
            <p className="mb-8 text-xl font-bold leading-relaxed">
              IntexuraOS reimagines productivity as an AI-first system. Instead of building another
              app that uses AI as a feature, we build AI agents that use apps as tools.
            </p>
            <p className="text-lg font-medium leading-relaxed">
              Your brain excels at creative thinking and decision-making. It struggles with
              remembering, scheduling, aggregating, and cross-referencing. IntexuraOS handles the
              cognitive load while you remain the commander.
            </p>
          </div>

          <div className="grid gap-6">
            <BrutalistCard title="No Dummy Success" icon={Shield}>
              <p className="text-neutral-700">
                A function either succeeds with a verified result or fails explicitly. We never return{' '}
                <code className="bg-neutral-200 px-1 py-0.5 text-sm">null</code> to silence an
                error.
              </p>
            </BrutalistCard>
            <BrutalistCard title="Hexagonal Architecture" icon={Layers}>
              <p className="text-neutral-700">
                Strict boundaries between Domain Logic and Infrastructure. Notion is just an adapter.
                The core logic is pure.
              </p>
            </BrutalistCard>
            <BrutalistCard title="Continuity Ledger" icon={FileText}>
              <p className="text-neutral-700">
                Complex reasoning is persisted. We treat the process of solving a problem as valuable
                data, logged in immutable markdown ledgers.
              </p>
            </BrutalistCard>
            <BrutalistCard title="Sleep-at-Night Reliability" icon={Zap}>
              <p className="text-neutral-700">
                95%+ coverage is not a target; it's a gate. If the code isn't proven to work, it
                doesn't merge.
              </p>
            </BrutalistCard>
          </div>
        </div>
      </div>
    </section>
  );
}

function RecentUpdatesSection(): React.JSX.Element {
  return (
    <section className="border-b-4 border-black bg-purple-100 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <SectionHeading>Latest System Capabilities</SectionHeading>
        <p className="mb-12 max-w-2xl text-lg font-medium text-neutral-700">
          Continuous improvements to the command classification and action execution pipeline.
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          <BrutalistCard title="Linear Integration" icon={CheckSquare} className="bg-purple-50">
            <p className="mb-3 text-neutral-700">
              Create Linear issues via natural language commands through WhatsApp or the PWA.
            </p>
            <p className="font-mono text-sm italic text-neutral-500">
              "Create a bug ticket for the login page timeout issue"
            </p>
          </BrutalistCard>
          <BrutalistCard title="Smart Auto-Execute" icon={Zap} className="bg-yellow-50">
            <p className="mb-3 text-neutral-700">
              High-confidence link actions (≥90%) are auto-executed without manual approval,
              reducing friction for common bookmarking workflows.
            </p>
            <p className="font-mono text-sm italic text-neutral-500">
              Links are processed instantly when intent is clear.
            </p>
          </BrutalistCard>
          <BrutalistCard title="Calendar Events" icon={Layers} className="bg-green-50">
            <p className="mb-3 text-neutral-700">
              Natural language calendar event creation. Mention a date in your command and the
              CalendarAgent creates the event.
            </p>
            <p className="font-mono text-sm italic text-neutral-500">
              "Schedule a review meeting for Friday at 2pm"
            </p>
          </BrutalistCard>
        </div>
      </div>
    </section>
  );
}

function Footer(): React.JSX.Element {
  return (
    <footer className="bg-white px-6 py-12">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 md:flex-row md:items-center">
        <div>
          <h3 className="mb-2 text-2xl font-black uppercase tracking-tighter">IntexuraOS</h3>
          <p className="font-mono text-sm text-neutral-500">
            © {new Date().getFullYear()} <a href="https://pbuchman.com" className="hover:text-cyan-600">Piotr Buchman</a>. Open Source.
          </p>
        </div>
        <div className="flex gap-8 font-mono text-sm font-bold uppercase">
          <a
            href="https://github.com/pbuchman/intexuraos"
            className="flex items-center gap-1 hover:text-cyan-600"
          >
            GitHub <ArrowRight className="h-4 w-4" />
          </a>
          <a
            href="https://www.linkedin.com/in/piotrbuchman/"
            className="flex items-center gap-1 hover:text-cyan-600"
          >
            LinkedIn <ArrowRight className="h-4 w-4" />
          </a>
          <a
            href="mailto:kontakt@pbuchman.com"
            className="flex items-center gap-1 hover:text-cyan-600"
          >
            Email <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </footer>
  );
}

// --- Main Page ---

export function HomePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-neutral-100 font-sans text-black selection:bg-cyan-300 selection:text-black">
      <HeroSection />
      <DemoSection />
      <CouncilSection />
      <ManifestoSection />
      <RecentUpdatesSection />
      <Footer />
    </div>
  );
}
