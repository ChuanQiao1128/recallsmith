export interface EmptyStateCta {
  label: string;
  onClick: () => void;
}

export interface EmptyStateProps {
  icon?: string;
  title: string;
  body?: string;
  cta?: EmptyStateCta;
}

export function EmptyState({ icon, title, body, cta }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center w-full max-w-sm mx-auto py-12 px-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
      {icon && (
        <div className="text-5xl mb-4">{icon}</div>
      )}
      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50 text-center">
        {title}
      </h3>
      {body && (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 text-center">
          {body}
        </p>
      )}
      {cta && (
        <button
          onClick={cta.onClick}
          className="mt-4 px-4 py-2 rounded-md bg-indigo-600 dark:bg-indigo-700 text-white dark:text-white hover:bg-indigo-700 dark:hover:bg-indigo-600 active:bg-indigo-800 dark:active:bg-indigo-800 text-sm font-medium transition-colors duration-150"
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}
