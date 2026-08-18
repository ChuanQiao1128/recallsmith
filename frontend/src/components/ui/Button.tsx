// src/components/ui/Button.tsx
//
// The console's one shared button. Its only caller today is ConfirmDialog,
// which renders Cancel and Confirm through it — so a `dark:` variant here lands
// inside that dialog. See the note at the top of ConfirmDialog.tsx for why this
// application is deliberately single-theme; tests/singleTheme.test.ts enforces
// it across src/.

import type { ReactNode, Ref } from 'react';
import { forwardRef } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
  onClick?: () => void;
  className?: string;
  autoFocus?: boolean;
}

const ButtonComponent = (
  {
    variant = 'primary',
    size = 'md',
    children,
    disabled = false,
    loading = false,
    type = 'button',
    title,
    onClick,
    className,
    autoFocus = false,
  }: ButtonProps,
  ref: Ref<HTMLButtonElement>
) => {
  const baseClasses =
    'inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed';

  const sizeClasses = size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm';

  const variantClasses =
    variant === 'primary'
      ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-indigo-600'
      : variant === 'secondary'
        ? 'bg-slate-100 text-slate-900 hover:bg-slate-200 active:bg-slate-300'
        : variant === 'ghost'
          ? 'bg-transparent text-slate-600 hover:bg-slate-50 active:bg-slate-100'
          : 'bg-red-50 text-red-700 hover:bg-red-100 active:bg-red-200';

  const finalClasses = `${baseClasses} ${sizeClasses} ${variantClasses} ${className || ''}`;

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      title={title}
      onClick={onClick}
      autoFocus={autoFocus}
      className={finalClasses}
    >
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
