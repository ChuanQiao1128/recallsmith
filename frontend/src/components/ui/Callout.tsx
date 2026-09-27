// src/components/ui/Callout.tsx
import type { PropsWithChildren } from 'react';

type Tone = 'info' | 'success' | 'warning' | 'danger';

/**
 * `role` makes the callout a live region: 'alert' for an error the user must
 * act on, 'status' for a result. Omit it for static content, and only set it on
 * a callout that mounts with (or after) the text it announces.
 */
export function Callout({
  tone,
  title,
  role,
  id,
  children,
}: PropsWithChildren<{ tone: Tone; title?: string; role?: 'alert' | 'status'; id?: string }>) {
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
    <div className={`${base} ${cls}`} role={role} id={id}>
      {title ? <div className="text-sm font-semibold mb-1">{title}</div> : null}
      <div className="text-sm">{children}</div>
    </div>
  );
}