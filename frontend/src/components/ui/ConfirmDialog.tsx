import { useCallback, useState, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { ConfirmContext, type ConfirmOptions } from './ConfirmDialogContext';

interface DialogState {
  options: ConfirmOptions | null;
  resolve: ((value: boolean) => void) | null;
}

export interface ConfirmDialogProviderProps {
  children: ReactNode;
}

export function ConfirmDialogProvider({ children }: ConfirmDialogProviderProps) {
  const [state, setState] = useState<DialogState>({ options: null, resolve: null });
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ options, resolve });
    });
  }, []);

  const handleConfirm = () => {
    if (state.resolve) {
      state.resolve(true);
      setState({ options: null, resolve: null });
    }
  };

  const handleCancel = () => {
    if (state.resolve) {
      state.resolve(false);
      setState({ options: null, resolve: null });
    }
  };

  // Focus trap: keep focus within dialog
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      handleCancel();
    }
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      {state.options && (
        <div
          className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={handleCancel}
          onKeyDown={handleKeyDown}
          role="presentation"
        >
          <div
            className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 shadow-lg max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-body"
          >
            <h2 id="confirm-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {state.options.title}
            </h2>
            {state.options.body && (
              <p id="confirm-body" className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                {state.options.body}
              </p>
            )}

            <div className="mt-6 flex gap-3 justify-end">
              <Button
                ref={cancelButtonRef}
                variant="secondary"
                size="md"
                onClick={handleCancel}
              >
                Cancel
              </Button>
              <Button
                variant={state.options.destructive ? 'danger' : 'primary'}
                size="md"
                onClick={handleConfirm}
                autoFocus
              >
                {state.options.destructive ? 'Delete' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

// For direct use (non-hook version)
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onCancel}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 shadow-lg max-w-sm w-full p-6"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-body"
      >
        <h2 id="dialog-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {title}
        </h2>
        {body && (
          <p id="dialog-body" className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {body}
          </p>
        )}

        <div className="mt-6 flex gap-3 justify-end">
          <Button variant="secondary" size="md" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            size="md"
            onClick={onConfirm}
          >
            {destructive ? 'Delete' : 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  );
}
