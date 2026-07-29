import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  MessageCircleMore,
  Newspaper,
  RefreshCw,
  Settings,
  Smartphone,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type {
  MessageDigestDeliveryReadiness,
  MessageDigestSourceSummary,
} from '@/types/messageDigests';
import { maskMessageDigestPrimaryNumber } from '@/types/messageDigests';

interface MessageDigestDeliveryPathProps {
  source: MessageDigestSourceSummary;
  readiness: MessageDigestDeliveryReadiness | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
}

export function MessageDigestDeliveryPath({
  source,
  readiness,
  isLoading,
  error,
  onRefresh,
}: MessageDigestDeliveryPathProps): React.JSX.Element {
  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6"
      aria-labelledby="delivery-path-title"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id="delivery-path-title"
            className="text-lg font-semibold text-slate-950 dark:text-slate-50"
          >
            From conversation to WhatsApp
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
            The selected conversation is read-only. Delivery always uses the first WhatsApp number
            mapped to your account.
          </p>
        </div>
        <Link
          to="/settings/whatsapp"
          aria-label="Open WhatsApp settings"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-300 dark:hover:bg-blue-950/40"
        >
          <Settings aria-hidden="true" className="h-4 w-4" />
          WhatsApp settings
        </Link>
      </div>

      <div className="mt-5 grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
        <PathNode
          icon={<MessageCircleMore aria-hidden="true" className="h-5 w-5" />}
          eyebrow="Source"
          title={source.displayName}
          detail="Private WhatsApp Mirror"
        />
        <PathArrow />
        <PathNode
          icon={<Newspaper aria-hidden="true" className="h-5 w-5" />}
          eyebrow="Digest"
          title="Message Digest Service"
          detail="Summarizes only the selected window"
        />
        <PathArrow />
        <DeliveryNode
          readiness={readiness}
          isLoading={isLoading}
          error={error}
          onRefresh={onRefresh}
        />
      </div>
    </section>
  );
}

function PathNode({
  icon,
  eyebrow,
  title,
  detail,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  detail: string;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/50">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {eyebrow}
        </p>
        <p className="mt-1 break-words text-sm font-semibold text-slate-950 dark:text-slate-50">
          {title}
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</p>
      </div>
    </div>
  );
}

function PathArrow(): React.JSX.Element {
  return (
    <span
      className="flex h-5 items-center justify-center text-slate-400 md:h-auto"
      aria-hidden="true"
    >
      <ArrowRight className="h-5 w-5 rotate-90 md:rotate-0" />
    </span>
  );
}

function DeliveryNode({
  readiness,
  isLoading,
  error,
  onRefresh,
}: {
  readiness: MessageDigestDeliveryReadiness | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
}): React.JSX.Element {
  if (isLoading) {
    return (
      <PathNode
        icon={
          <RefreshCw
            aria-hidden="true"
            className="h-5 w-5 animate-spin motion-reduce:animate-none"
          />
        }
        eyebrow="Delivery"
        title="Checking primary WhatsApp…"
        detail="No separate recipient is configured"
      />
    );
  }
  if (error !== null || readiness === null) {
    return (
      <div className="flex min-w-0 gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide">Delivery</p>
          <p className="mt-1 text-sm font-semibold">Readiness unavailable</p>
          <button
            type="button"
            onClick={(): void => {
              void onRefresh();
            }}
            className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold underline focus:outline-none focus:ring-2 focus:ring-amber-600"
          >
            Retry delivery check
          </button>
        </div>
      </div>
    );
  }
  if (readiness.status === 'ready') {
    return (
      <div className="flex min-w-0 gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <Smartphone aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            Delivery
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
            <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
            {maskMessageDigestPrimaryNumber(readiness.maskedPrimaryNumber)}
          </p>
          <p className="mt-1 text-xs leading-5 text-emerald-800 dark:text-emerald-200">
            First mapped WhatsApp number
          </p>
        </div>
      </div>
    );
  }
  const reason = {
    mapping_missing: 'No primary WhatsApp number is mapped',
    disconnected: 'WhatsApp is disconnected',
    delivery_disabled: 'WhatsApp delivery is disabled',
  }[readiness.status];
  return (
    <div className="flex min-w-0 gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide">Delivery</p>
        <p className="mt-1 break-words text-sm font-semibold">{reason}</p>
        <p className="mt-1 text-xs leading-5">Open settings to restore delivery.</p>
      </div>
    </div>
  );
}
