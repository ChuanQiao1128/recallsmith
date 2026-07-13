import { useState } from 'react';

export interface ErrorCardProps {
  title: string;
  body?: string;
  retry?: () => void;
  onDismiss?: () => void;
}

export function ErrorCard({ title, body, retry, onDismiss }: ErrorCardProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <div className="w-full bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
      <div className="flex gap-4">
        <div className="flex-1">
          <h3 className="font-semibold text-red-900 dark:text-red-100">{title}</h3>
          {body && (
            <p className="mt-1 text-sm text-red-800 dark:text-red-200">{body}</p>
          )}
          {retry && (
            <button
              onClick={retry}
              className="mt-3 text-sm font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200 underline"
            >
              Try again
            </button>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 text-red-400 dark:text-red-600 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          aria-label="Dismiss error"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
