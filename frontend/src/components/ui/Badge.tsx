// src/components/ui/Badge.tsx
import type { PropsWithChildren } from 'react';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function Badge({ tone, children }: PropsWithChildren<{ tone: Tone }>) {
  const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border';

  const cls =
    tone === 'success'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
      : tone === 'warning'
        ? 'bg-amber-50 border-amber-200 text-amber-900'
        : tone === 'danger'
          ? 'bg-red-50 border-red-200 text-red-800'
          : tone === 'info'
            ? 'bg-sky-50 border-sky-200 text-sky-800'
            : 'bg-slate-100 border-slate-200 text-slate-700';

  return <span className={`${base} ${cls}`}>{children}</span>;
}