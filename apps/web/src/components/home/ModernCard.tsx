import React from 'react';
import { motion } from 'framer-motion';

export function ModernCard({
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
