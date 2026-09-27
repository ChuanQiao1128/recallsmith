// src/components/ui/Button.tsx
//
// The console's one shared button. ConfirmDialog renders Cancel and Confirm
// through it, and the four HITL pages (Review queue, AI QA, Automation ledger,
// Webhooks) render every action through it, so they share its focus-visible
// ring instead of relying on the browser's default outline. A `dark:` variant
// here lands on all of them. See the note at the top of ConfirmDialog.tsx for
// why this application is deliberately single-theme; tests/singleTheme.test.ts
// enforces it across src/.

import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { forwardRef } from 'react';

/** `outline` is the secondary action on the dense HITL pages: white with a slate border. */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
/** `xs` is the compact size the HITL tables and forms use. */
export type ButtonSize = 'xs' | 'sm' | 'md';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

const ButtonComponent = (
  {
    variant = 'primary',
    size = 'md',
    children,
    disabled = false,
    loading = false,
    type = 'button',
    className,
    ...rest
  }: ButtonProps,
  ref: Ref<HTMLButtonElement>
) => {
  const baseClasses =
    'inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed';

  const sizeClasses = size === 'xs' ? 'px-3 py-1.5 text-xs' : size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm';

  const variantClasses =
    variant === 'primary'
      ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-indigo-600'
      : variant === 'secondary'
        ? 'bg-slate-100 text-slate-900 hover:bg-slate-200 active:bg-slate-300'
        : variant === 'outline'
          ? 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 active:bg-slate-100'
          : variant === 'ghost'
            ? 'bg-transparent text-slate-600 hover:bg-slate-50 active:bg-slate-100'
            : 'bg-red-50 text-red-700 hover:bg-red-100 active:bg-red-200';

  const finalClasses = `${baseClasses} ${sizeClasses} ${variantClasses} ${className || ''}`;

  return (
    <button {...rest} ref={ref} type={type} disabled={disabled || loading} className={finalClasses}>
      {loading ? (
        <>
          <span className="inline-block w-4 h-4 mr-2 border-2 border-current border-t-transparent rounded-full animate-spin" />
          {children}
        </>
      ) : (
        children
      )}
    </button>
  );
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(ButtonComponent);
