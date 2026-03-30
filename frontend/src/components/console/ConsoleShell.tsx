// src/components/console/ConsoleShell.tsx


type Props = {
  title: string;
  subtitle?: string;
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


  return (
    <div className="min-h-screen bg-slate-100">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-[1600px] w-full mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">{title}</div>
            {subtitle ? <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div> : null}
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <span className="text-xs px-2 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
              {userLabel}
            </span>

            {superAdmin && onGoAdminUsers ? (
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
        {/* Main */}
        <main className="space-y-4">{children}</main>
      </div>
    </div>
  );
}