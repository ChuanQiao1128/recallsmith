// src/components/ui/Callout.tsx
import type { PropsWithChildren } from 'react';

type Tone = 'info' | 'success' | 'warning' | 'danger';

export function Callout({
  tone,
  title,
  children,
}: PropsWithChildren<{ tone: Tone; title?: string }>) {
  const base = 'border rounded px-3 py-2';

  const cls =
    tone === 'success'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
      : tone === 'warning'
        ? 'bg-amber-50 border-amber-200 text-amber-900'
        : tone === 'danger'
          ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-sky-50 border-sky-200 text-sky-800';

  return (
    <div className={`${base} ${cls}`}>
      {title ? <div className="text-sm font-semibold mb-1">{title}</div> : null}
      <div className="text-sm">{children}</div>
    </div>
  );
}