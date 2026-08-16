// src/components/ui/ErrorBanner.tsx
//
// The one way the console shows a failed action.
//
// Why it looks like the publish-jobs banner already on DeckListPage: that
// treatment is the console's existing language for "something is wrong and it
// is on this page", and a second look invented here would make two failures on
// the same screen read as two unrelated products. The only thing added is the
// kind, because a refusal and a transport failure need opposite advice and the
// user should be able to tell them apart before reading a word.
//
// Why there is no portal, no overlay and no timer: the banner sits in the
// document flow of the page that owns the failed action. It cannot park the
// main thread the way window.alert did, it cannot cover the control the user
// was aiming at, and it stays until the operation is retried or dismissed.

import type { ErrorNotice } from '../../lib/errorFeed';
import { KIND_HINT, KIND_LABEL } from '../../lib/errorFeed';

interface ToneClasses {
  box: string;
  icon: string;
  title: string;
  body: string;
  action: string;
  dismiss: string;
}

// Red is the refusal the server chose to state; amber is the uncertain one,
// matching how Callout.tsx already spends danger against warning.
const TONES: Record<ErrorNotice['kind'], ToneClasses> = {
  business: {
    box: 'bg-red-50 border-red-200',
    icon: 'text-red-600',
    title: 'text-red-800',
    body: 'text-red-700',
    action: 'text-red-800 hover:text-red-900',
    dismiss: 'text-red-500 hover:text-red-800',
  },
  network: {
    box: 'bg-amber-50 border-amber-200',
    icon: 'text-amber-600',
    title: 'text-amber-900',
    body: 'text-amber-800',
    action: 'text-amber-900 hover:text-amber-950',
    dismiss: 'text-amber-600 hover:text-amber-900',
  },
};

export interface ErrorBannerProps {
  notice: ErrorNotice;
  /** Omitted for notices derived from live state, which clear themselves. */
  onDismiss?: () => void;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorBanner({ notice, onDismiss, onRetry, retryLabel }: ErrorBannerProps) {
  const tone = TONES[notice.kind];

  return (
    // role=alert announces the failure to assistive tech without taking the
    // thread hostage, which is the part window.alert got right and paid too
    // much for.
    <div
      role="alert"
      className={`${tone.box} border rounded-xl p-4 flex items-start gap-3 shadow-sm`}
    >
      <svg
        className={`w-5 h-5 ${tone.icon} shrink-0 mt-0.5`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>

      <div className="flex-1 min-w-0">
        <h3 className={`text-sm font-semibold ${tone.title}`}>{notice.title}</h3>
        <p className={`text-xs font-medium mt-1 ${tone.body}`}>{KIND_LABEL[notice.kind]}</p>
        {notice.detail ? (
          <p className={`text-xs mt-1 break-words ${tone.body}`}>{notice.detail}</p>
        ) : null}
        <p className={`text-xs mt-1 opacity-80 ${tone.body}`}>{KIND_HINT[notice.kind]}</p>

        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className={`mt-2 text-xs font-semibold underline underline-offset-2 ${tone.action}`}
          >
            {retryLabel ?? 'Try again'}
          </button>
        ) : null}
      </div>

      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Dismiss: ${notice.title}`}
          className={`shrink-0 text-sm leading-none px-1 ${tone.dismiss}`}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

export interface ErrorBannerListProps {
  notices: readonly ErrorNotice[];
  onDismiss: (key: string) => void;
}

export function ErrorBannerList({ notices, onDismiss }: ErrorBannerListProps) {
  if (notices.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {notices.map(notice => (
        <ErrorBanner
          key={notice.key}
          notice={notice}
          onDismiss={() => onDismiss(notice.key)}
        />
      ))}
    </div>
  );
}
