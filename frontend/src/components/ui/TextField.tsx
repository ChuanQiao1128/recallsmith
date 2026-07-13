import { useId } from 'react';

export interface TextFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'email' | 'number' | 'password';
  error?: string;
  helperText?: string;
  required?: boolean;
  disabled?: boolean;
  monospace?: boolean;
  rows?: number;
  maxLength?: number;
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  error,
  helperText,
  required = false,
  disabled = false,
  monospace = false,
  maxLength,
}: Omit<TextFieldProps, 'rows'>) {
  const id = useId();

  const baseClasses =
    'w-full px-3 py-2 rounded-md border text-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

  const borderClasses = error
    ? 'border-red-300 dark:border-red-700'
    : 'border-slate-300 dark:border-slate-600';

  const bgClasses = disabled
    ? 'bg-slate-50 dark:bg-slate-900 opacity-50 cursor-not-allowed'
    : 'bg-white dark:bg-slate-950';

  const textClasses = disabled ? 'text-slate-500' : 'text-slate-900 dark:text-slate-50';

  const finalClasses = `${baseClasses} ${borderClasses} ${bgClasses} ${textClasses} ${monospace ? 'font-mono' : ''}`;

  return (
    <div>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          {label}
          {required && <span className="text-red-600 ml-1">*</span>}
        </label>
      )}
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        aria-describedby={error ? `${id}-error` : helperText ? `${id}-helper` : undefined}
        className={finalClasses}
      />
      {error && (
        <div id={`${id}-error`} className="mt-1 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      {helperText && !error && (
        <div id={`${id}-helper`} className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {helperText}
        </div>
      )}
    </div>
  );
}

export interface TextAreaProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  error?: string;
  helperText?: string;
  required?: boolean;
  disabled?: boolean;
  rows?: number;
  maxLength?: number;
}

export function TextArea({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  error,
  helperText,
  required = false,
  disabled = false,
  rows = 4,
  maxLength,
}: TextAreaProps) {
  const id = useId();

  const baseClasses =
    'w-full px-3 py-2 rounded-md border text-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none';

  const borderClasses = error
    ? 'border-red-300 dark:border-red-700'
    : 'border-slate-300 dark:border-slate-600';

  const bgClasses = disabled
    ? 'bg-slate-50 dark:bg-slate-900 opacity-50 cursor-not-allowed'
    : 'bg-white dark:bg-slate-950';

  const textClasses = disabled ? 'text-slate-500' : 'text-slate-900 dark:text-slate-50';

  const finalClasses = `${baseClasses} ${borderClasses} ${bgClasses} ${textClasses}`;

  return (
    <div>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          {label}
          {required && <span className="text-red-600 ml-1">*</span>}
        </label>
      )}
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        maxLength={maxLength}
        aria-describedby={error ? `${id}-error` : helperText ? `${id}-helper` : undefined}
        className={finalClasses}
      />
      {error && (
        <div id={`${id}-error`} className="mt-1 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      {helperText && !error && (
        <div id={`${id}-helper`} className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {helperText}
        </div>
      )}
    </div>
  );
}
