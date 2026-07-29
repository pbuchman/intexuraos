import { AlertTriangle, CheckCircle2, CircleDashed, Clock3, MinusCircle } from 'lucide-react';
import type {
  MessageDigestDeliveryStatus,
  MessageDigestProcessingStage,
  MessageDigestRun,
} from '@/types/messageDigests';
import { getMessageDigestDeliveryStatusLabel } from '@/types/messageDigests';

interface MessageDigestRunStatusProps {
  run: MessageDigestRun;
  compact?: boolean;
}

const PROCESSING_STAGE_LABELS: Record<MessageDigestProcessingStage, string> = {
  queued: 'Queued',
  reading_messages: 'Reading messages',
  aggregating: 'Generating',
  repairing: 'Repairing summary',
  completed: 'Completed',
  failed: 'Failed',
  skipped_no_activity: 'Skipped — no new messages',
};

export function MessageDigestRunStatus({
  run,
  compact = false,
}: MessageDigestRunStatusProps): React.JSX.Element {
  const active =
    run.generationStatus === 'queued' ||
    run.generationStatus === 'processing' ||
    run.delivery.status === 'pending';
  return (
    <div
      role={active ? 'status' : undefined}
      aria-live={active ? 'polite' : undefined}
      className={`grid min-w-0 gap-3 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2'}`}
    >
      <StatusDimension
        label="Generation"
        value={getMessageDigestProcessingStageLabel(run.processingStage)}
        tone={generationTone(run.processingStage)}
        testId="generation-status"
      />
      <StatusDimension
        label="WhatsApp"
        value={getMessageDigestDeliveryStatusLabel(run.delivery.status)}
        tone={deliveryTone(run.delivery.status)}
        testId="delivery-status"
      />
    </div>
  );
}

export function getMessageDigestProcessingStageLabel(stage: MessageDigestProcessingStage): string {
  return PROCESSING_STAGE_LABELS[stage];
}

type StatusTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

function StatusDimension({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone: StatusTone;
  testId: string;
}): React.JSX.Element {
  const toneClasses: Record<StatusTone, string> = {
    neutral:
      'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300',
    progress:
      'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200',
    success:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
    warning:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    danger:
      'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
  };
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p
        data-testid={testId}
        className={`mt-1 inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClasses[tone]}`}
      >
        <StatusIcon tone={tone} />
        <span className="min-w-0 break-words">{value}</span>
      </p>
    </div>
  );
}

function StatusIcon({ tone }: { tone: StatusTone }): React.JSX.Element {
  if (tone === 'success') {
    return <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />;
  }
  if (tone === 'danger') {
    return <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />;
  }
  if (tone === 'warning') {
    return <Clock3 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />;
  }
  if (tone === 'progress') {
    return (
      <CircleDashed
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
      />
    );
  }
  return <MinusCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />;
}

function generationTone(stage: MessageDigestProcessingStage): StatusTone {
  if (stage === 'completed' || stage === 'skipped_no_activity') return 'success';
  if (stage === 'failed') return 'danger';
  return 'progress';
}

function deliveryTone(status: MessageDigestDeliveryStatus): StatusTone {
  if (status === 'sent') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'ambiguous') return 'warning';
  if (status === 'pending') return 'progress';
  return 'neutral';
}
