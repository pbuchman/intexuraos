import React from 'react';
import { motion } from 'framer-motion';

export function GettingStartedSection(): React.JSX.Element {
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
            { num: '3', title: 'Send a Message', desc: 'Type your first request. The platform provides fallback AI access for research and bookmarks — no API keys needed to start. Coding tasks use your own Anthropic subscription.' },
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
