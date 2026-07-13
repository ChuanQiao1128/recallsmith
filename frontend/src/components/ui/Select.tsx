import { useId } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  error?: string;
  helperText?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function Select({
  label,
  value,
  onChange,
  options,
  error,
  helperText,
  required = false,
  disabled = false,
  placeholder,
}: SelectProps) {
  const id = useId();

  const baseClasses =
    'w-full px-3 py-2 rounded-md border text-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 appearance-none';

  const borderClasses = error
    ? 'border-red-300 dark:border-red-700'
    : 'border-slate-300 dark:border-slate-600';

  const bgClasses = disabled
    ? 'bg-slate-50 dark:bg-slate-900 opacity-50 cursor-not-allowed'
    : 'bg-white dark:bg-slate-950';

  const textClasses = disabled ? 'text-slate-500' : 'text-slate-900 dark:text-slate-50';

  const finalClasses = `${baseClasses} ${borderClasses} ${bgClasses} ${textClasses} pr-8 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 20 20%22%3E%3Cpath stroke=%22%236b7280%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22 stroke-width=%221.5%22 d=%22M6 8l4 4 4-4%22/%3E%3C/svg%3E')] bg-no-repeat bg-right bg-center dark:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 20 20%22%3E%3Cpath stroke=%22%23cbd5e1%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22 stroke-width=%221.5%22 d=%22M6 8l4 4 4-4%22/%3E%3C/svg%3E')]`;

  return (
    <div>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          {label}
          {required && <span className="text-red-600 ml-1">*</span>}
        </label>
      )}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-describedby={error ? `${id}-error` : helperText ? `${id}-helper` : undefined}
        className={finalClasses}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
