import { Link } from 'react-router-dom';
import {
  BarChart3,
  Brain,
  Calendar,
  CheckSquare,
  ChevronRight,
  Cpu,
  FileText,
  Globe,
  Layers,
  Layout,
  Lock,
  MessageSquare,
  Mic,
  Shield,
  Zap,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

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

// --- Shared Components ---

function FeatureCard({
  title,
  description,
  icon: Icon,
  className = '',
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  className?: string;
}): React.JSX.Element {
  return (
    <motion.div
      whileHover={{ y: -5 }}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={`group relative overflow-hidden rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm transition-all hover:shadow-md ${className}`}
    >
      <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600 group-hover:bg-cyan-600 group-hover:text-white transition-colors">
        <Icon className="h-6 w-6" />
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
          <img src="/logo-primary-light.png" alt="IntexuraOS" className="h-8 w-auto" />
          <span className="font-bold tracking-tight text-neutral-900 hidden sm:inline">
            IntexuraOS
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/pbuchman/intexuraos"
            className="hidden text-sm font-medium text-neutral-600 hover:text-cyan-600 sm:flex items-center gap-1"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GithubIcon className="h-4 w-4" /> GitHub
          </a>
          <Link
            to="/login"
            className="rounded-full bg-black px-6 py-2 text-sm font-semibold text-white transition-transform hover:scale-105 active:scale-95 hover:bg-neutral-800"
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
    <section className="relative overflow-hidden bg-gradient-to-b from-cyan-50 to-white pt-32 pb-24">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 right-0 h-[500px] bg-gradient-to-br from-blue-100/50 via-cyan-50/30 to-transparent skew-y-[-6deg] transform -translate-y-24" />

      <div className="relative mx-auto max-w-7xl px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="mx-auto mb-6 flex max-w-fit items-center gap-2 rounded-full border border-cyan-200 bg-white/60 px-4 py-1.5 text-sm font-medium text-cyan-900 shadow-sm backdrop-blur-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500"></span>
            </span>
            v2.1.0 is now live
          </div>
          <h1 className="mx-auto mb-6 max-w-4xl text-5xl font-extrabold tracking-tight text-neutral-900 md:text-7xl lg:leading-[1.1]">
            Your brain is for{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 to-blue-600">
              thinking
            </span>
            ,
            <br /> not remembering.
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-lg text-neutral-600 md:text-xl leading-relaxed">
            IntexuraOS transforms fragmented information into structured intelligence. A council of
            17 AI models across 5 providers works autonomously — you remain the commander.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              to="/login"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-cyan-600 px-8 text-base font-semibold text-white shadow-lg shadow-cyan-600/20 transition-all hover:bg-cyan-700 hover:-translate-y-0.5"
            >
              Get Started <ChevronRight className="h-4 w-4" />
            </Link>
            <a
              href="https://github.com/pbuchman/intexuraos"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white px-8 text-base font-semibold text-neutral-900 transition-all hover:bg-neutral-50 hover:border-neutral-300"
            >
              View Source <GithubIcon className="h-4 w-4" />
            </a>
          </div>
        </motion.div>

        {/* Hero Visual/Dashboard Mockup */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.8 }}
          className="relative mx-auto mt-20 max-w-5xl rounded-2xl border border-neutral-200 bg-white/50 p-2 shadow-2xl backdrop-blur-xl"
        >
          <div className="absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-50"></div>
          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
            <div className="flex h-8 items-center gap-1.5 border-b border-neutral-100 bg-neutral-50 px-4">
              <div className="h-3 w-3 rounded-full bg-red-400/20"></div>
              <div className="h-3 w-3 rounded-full bg-amber-400/20"></div>
              <div className="h-3 w-3 rounded-full bg-green-400/20"></div>
            </div>
            <div className="p-8 h-[300px] flex items-center justify-center bg-neutral-50/50 relative overflow-hidden">
              <div className="absolute inset-0 grid grid-cols-[repeat(20,minmax(0,1fr))] opacity-[0.03]">
                {Array.from({ length: 400 }).map((_, i) => (
                  <div key={i} className="border-r border-b border-black aspect-square"></div>
                ))}
              </div>
              <div className="relative text-center z-10">
                <div className="inline-flex items-center justify-center p-4 bg-white rounded-2xl shadow-xl mb-4 border border-neutral-100">
                  <Brain className="w-12 h-12 text-cyan-600" />
                </div>
                <div className="text-neutral-400 font-mono text-sm">
                  System Active • All Agents Online
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function DemoLoopSection(): React.JSX.Element {
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    {
      title: 'Capture',
      icon: Mic,
      color: 'text-blue-500',
      bg: 'bg-blue-100',
      desc: 'Voice note, link, or text',
    },
    {
      title: 'Classify',
      icon: Brain,
      color: 'text-purple-500',
      bg: 'bg-purple-100',
      desc: 'AI determines intent',
    },
    {
      title: 'Execute',
      icon: CheckSquare,
      color: 'text-green-500',
      bg: 'bg-green-100',
      desc: 'Action performed automagically',
    },
  ];

  useEffect((): (() => void) => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % steps.length);
    }, 2500);
    return (): void => {
      clearInterval(interval);
    };
  }, []);

  return (
    <section className="bg-white py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <h2 className="text-4xl font-bold tracking-tight text-neutral-900 mb-6">
              The Intelligence Loop
            </h2>
            <p className="text-lg text-neutral-600 mb-8 leading-relaxed">
              18 specialized microservices route your intent to the right agent. A voice note
              becomes a research report. A shared link becomes a summarized bookmark. A date mention
              becomes a calendar event—instantly.
            </p>
            <div className="space-y-6">
              {steps.map((step, index) => (
                <div
                  key={step.title}
                  className={`flex items-start gap-4 rounded-xl p-4 transition-all duration-500 ${activeStep === index ? 'bg-neutral-50 shadow-sm border border-neutral-100' : 'opacity-50'}`}
                >
                  <div className={`p-3 rounded-lg ${step.bg}`}>
                    <step.icon className={`w-6 h-6 ${step.color}`} />
                  </div>
                  <div>
                    <h3
                      className={`font-semibold text-lg ${activeStep === index ? 'text-neutral-900' : 'text-neutral-700'}`}
                    >
                      {step.title}
                    </h3>
                    <p className="text-neutral-500">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-tr from-cyan-100 to-purple-100 rounded-full blur-3xl opacity-30"></div>
            <div className="relative rounded-3xl border border-neutral-200 bg-white p-8 shadow-2xl">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeStep}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="min-h-[200px] flex flex-col items-center justify-center text-center p-6"
                >
                  {activeStep === 0 && (
                    <>
                      <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center mb-4 text-white shadow-lg shadow-blue-200">
                        <Mic className="w-8 h-8" />
                      </div>
                      <div className="font-mono text-sm bg-neutral-100 px-4 py-2 rounded-lg text-neutral-600 mb-2">
                        Authenticated User Input
                      </div>
                      <p className="text-xl font-medium text-neutral-900">
                        "Research hexagonal architecture and schedule a review for Friday"
                      </p>
                    </>
                  )}
                  {activeStep === 1 && (
                    <>
                      <div className="w-16 h-16 bg-purple-500 rounded-full flex items-center justify-center mb-4 text-white shadow-lg shadow-purple-200">
                        <Brain className="w-8 h-8" />
                      </div>
                      <div className="flex gap-2 mb-4">
                        <span className="text-xs font-semibold bg-cyan-100 text-cyan-800 px-2 py-1 rounded">
                          Research
                        </span>
                        <span className="text-xs font-semibold bg-amber-100 text-amber-800 px-2 py-1 rounded">
                          Calendar
                        </span>
                      </div>
                      <p className="text-xl font-medium text-neutral-900">
                        Analyzing intent... splitting into parallel workflows.
                      </p>
                    </>
                  )}
                  {activeStep === 2 && (
                    <>
                      <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mb-4 text-white shadow-lg shadow-green-200">
                        <CheckSquare className="w-8 h-8" />
                      </div>
                      <div className="space-y-2 w-full max-w-xs text-left">
                        <div className="flex items-center gap-2 p-2 bg-green-50 rounded border border-green-100">
                          <FileText className="w-4 h-4 text-green-600" />
                          <span className="text-sm font-medium text-green-900">
                            Notion Page Created
                          </span>
                        </div>
                        <div className="flex items-center gap-2 p-2 bg-green-50 rounded border border-green-100">
                          <Calendar className="w-4 h-4 text-green-600" />
                          <span className="text-sm font-medium text-green-900">
                            Review Meeting Set
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CouncilSection(): React.JSX.Element {
  const models = [
    { name: 'ANTHROPIC', models: 'Opus 4.5, Sonnet 4.5', role: 'Analysis & Validation', icon: Cpu },
    { name: 'OPENAI', models: 'GPT-5.2, o4-mini', role: 'Deep Research & Images', icon: Zap },
    {
      name: 'GOOGLE',
      models: 'Gemini 2.5 Pro/Flash',
      role: 'Classification & Routing',
      icon: Brain,
    },
    { name: 'PERPLEXITY', models: 'Sonar Pro/Deep', role: 'Real-time Web Search', icon: Globe },
    { name: 'ZAI', models: 'GLM-4.7 / Flash', role: 'Multilingual Analysis', icon: MessageSquare },
  ];

  return (
    <section className="bg-neutral-950 py-24 text-white">
      <div className="mx-auto max-w-7xl px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight mb-4">The Council of AI</h2>
          <p className="text-neutral-400 max-w-2xl mx-auto">
            17 models across 5 providers. Not a single oracle, but a consensus engine. When they
            agree, you get certainty. When they disagree, you see the debate.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {models.map((provider) => (
            <motion.div
              key={provider.name}
              whileHover={{ y: -5, backgroundColor: 'rgba(255,255,255,0.1)' }}
              className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-6 text-center backdrop-blur-sm transition-colors"
            >
              <div className="mx-auto w-12 h-12 bg-neutral-800 rounded-full flex items-center justify-center mb-4 text-neutral-300">
                <provider.icon className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-lg mb-1">{provider.name}</h3>
              <p className="text-xs font-mono text-cyan-400 mb-2">{provider.models}</p>
              <p className="text-sm text-neutral-500">{provider.role}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesGrid(): React.JSX.Element {
  const features = [
    {
      title: 'Hexagonal Architecture',
      desc: 'Strict boundaries between Domain Logic and Infrastructure. Notion is just an adapter. The core logic is pure.',
      icon: Hexagon,
    },
    {
      title: 'No Dummy Success',
      desc: 'A function either succeeds with a verified result or fails explicitly. We never return null to silence an error.',
      icon: Shield,
    },
    {
      title: 'Source Attribution',
      desc: 'Every claim links to which model said it. No black-box answers — trace any statement back to its origin.',
      icon: FileText,
    },
    {
      title: 'Cost Transparency',
      desc: "Every LLM call tracked: model, tokens, cost. Know exactly what you're spending before and after each query.",
      icon: BarChart3,
    },
    {
      title: 'Sleep-at-Night Reliability',
      desc: "95%+ coverage is not a target; it's a gate. If the code isn't proven to work, it doesn't merge.",
      icon: Lock,
    },
    {
      title: 'Linear Integration',
      desc: 'New 3-column dashboard optimized for daily standups. Planning, Work, and Closed fully synced.',
      icon: Layout,
    },
  ];

  return (
    <section className="bg-neutral-50 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-neutral-900 mb-4">
            Intelligence as Infrastructure
          </h2>
          <p className="text-lg text-neutral-600 max-w-2xl mx-auto">
            Built with the rigor of a financial system. Type-safe, tested, and observable.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((f) => (
            <FeatureCard key={f.title} title={f.title} description={f.desc} icon={f.icon} />
          ))}
        </div>
      </div>
    </section>
  );
}

// Helper for Hexagon icon since it might not be in the imported set
function Hexagon({ className }: { className?: string }): React.JSX.Element {
  return <Layers className={className} />;
}

function Footer(): React.JSX.Element {
  return (
    <footer className="bg-white border-t border-neutral-100 py-12">
      <div className="mx-auto max-w-7xl px-6 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 bg-cyan-600 rounded-md"></div>
          <span className="font-bold text-neutral-900">IntexuraOS</span>
        </div>
        <p className="text-sm text-neutral-500">
          © {new Date().getFullYear()} Piotr Buchman. Open Source.
        </p>
        <div className="flex gap-6">
          <a
            href="https://github.com/pbuchman"
            className="text-neutral-400 hover:text-neutral-900 transition-colors"
          >
            <GithubIcon className="w-5 h-5" />
          </a>
          <a
            href="https://linkedin.com/in/piotrbuchman"
            className="text-neutral-400 hover:text-neutral-900 transition-colors"
          >
            <LinkedinIcon className="w-5 h-5" />
          </a>
        </div>
      </div>
    </footer>
  );
}

export function HomePage(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-white font-sans text-neutral-900 selection:bg-cyan-100 selection:text-cyan-900">
      <Navbar />
      <HeroSection />
      <DemoLoopSection />
      <CouncilSection />
      <FeaturesGrid />
      <Footer />
    </div>
  );
}
