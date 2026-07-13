// src/components/console/ConsoleShell.tsx
import { useLocation } from 'react-router-dom';

type Props = {
  title: string;
  subtitle?: string;
  /** When the session has no user yet, leave this empty to suppress the "—" pill. */
  userLabel: string;
  superAdmin: boolean;
  onSignOut: () => void;

  onGoAdminUsers?: () => void;

  children: React.ReactNode;
};

export function ConsoleShell({
  title,
  subtitle,
  userLabel,
  superAdmin,
  onSignOut,
  onGoAdminUsers,
  children,
}: Props) {
  const { pathname } = useLocation();

  // Don't show the "Admin Management" button when we're already on /admin/*
  // (it's currently shown everywhere and is redundant once you're inside admin).
  const onAdminPage = pathname.startsWith('/admin/');
  const showAdminButton = superAdmin && !!onGoAdminUsers && !onAdminPage;

  // Hide the "—" placeholder pill when there's no user info yet — it visually
  // looks like a notification badge / minus icon and confuses the user.
  const showUserPill = userLabel.trim().length > 0 && userLabel.trim() !== '—';

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-[1600px] w-full mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-slate-900 truncate">{title}</div>
            {subtitle ? <div className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</div> : null}
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
            {showUserPill && (
              <span className="text-xs px-2 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
                {userLabel}
              </span>
            )}

            {showAdminButton ? (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                onClick={onGoAdminUsers}
                title="Manage users and permissions (super_admin only)"
              >
                Admin Management
              </button>
            ) : null}

            <button
              type="button"
              className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={onSignOut}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="max-w-[1600px] w-full mx-auto px-4 py-6">
        <main className="space-y-4">{children}</main>
      </div>
    </div>
  );
}
