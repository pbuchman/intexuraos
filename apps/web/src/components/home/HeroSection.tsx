import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Mail } from 'lucide-react';
import { GithubIcon, LinkedinIcon } from './BrandIcons.js';
import { HeroShowcase } from './HeroShowcase.js';

export function HeroSection(): React.JSX.Element {
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
            IntexuraOS v3.7.0
          </div>

          <p className="mx-auto mb-4 max-w-xl text-lg leading-relaxed text-neutral-600">
            You remember the bug while walking to lunch. You think of a research question on the commute home.
            You need a system that can safely act before the moment disappears.
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
            IntexuraOS is a personal agentic operating system made of specialist agents.
            Send a WhatsApp text message or dashboard task and come back to a calendar event,
            cited research report, summarized bookmark, writing draft, or tested pull request.
          </p>

          <p className="mx-auto mb-10 max-w-2xl text-lg font-semibold leading-relaxed text-neutral-500">
            The AI brings judgment; deterministic software boundaries decide what it may touch.
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
