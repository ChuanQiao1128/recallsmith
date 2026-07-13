export interface LoadingStateProps {
  variant: 'block' | 'inline' | 'skeleton';
  message?: string;
}

export function LoadingState({ variant, message }: LoadingStateProps) {
  if (variant === 'block') {
    return (
      <div className="w-full h-64 flex flex-col items-center justify-center gap-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="w-8 h-8 border-3 border-indigo-600 dark:border-indigo-500 border-t-transparent rounded-full animate-spin" />
        {message && (
          <p className="text-sm text-slate-600 dark:text-slate-400">{message}</p>
        )}
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div className="inline-flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-indigo-600 dark:border-indigo-500 border-t-transparent rounded-full animate-spin" />
        {message && (
          <span className="text-sm text-slate-600 dark:text-slate-400">{message}</span>
        )}
      </div>
    );
  }

  // skeleton
  return (
    <div className="space-y-2">
      <div className="h-5 w-3/4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
      <div className="h-5 w-1/2 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
    </div>
  );
}
