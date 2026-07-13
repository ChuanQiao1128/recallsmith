import type { ReactNode } from 'react';

export interface PageHeaderAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: (PageHeaderAction | ReactNode)[];
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="border-b border-slate-200 dark:border-slate-700 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {subtitle}
            </p>
          )}
        </div>

        {actions && actions.length > 0 && (
          <div className="flex gap-2 flex-shrink-0 mt-1">
            {actions.map((action, idx) => {
              if (!action) return null;

              // Check if it's a ReactNode (button or element)
              if (typeof action === 'object' && 'props' in action) {
                return <div key={idx}>{action}</div>;
              }

              // It's an action object
              const { label, onClick, variant = 'primary' } = action as PageHeaderAction;
              const bgClass =
                variant === 'primary'
                  ? 'bg-indigo-600 dark:bg-indigo-700 text-white hover:bg-indigo-700 dark:hover:bg-indigo-600'
                  : variant === 'danger'
                    ? 'bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50 hover:bg-slate-200 dark:hover:bg-slate-700';

              return (
                <button
                  key={idx}
                  onClick={onClick}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors duration-150 ${bgClass}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
