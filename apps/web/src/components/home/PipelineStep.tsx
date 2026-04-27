import React from 'react';
import { motion } from 'framer-motion';

export function PipelineStep({
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
