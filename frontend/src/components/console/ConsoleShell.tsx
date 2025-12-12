// src/components/console/ConsoleShell.tsx
import { Link, useLocation } from 'react-router-dom';

type Props = {
  title: string;
  subtitle?: string;
  userLabel: string;
  superAdmin: boolean;
  onSignOut: () => void;

  onGoAdminUsers?: () => void;

  children: React.ReactNode;
};

function NavItem(props: { to: string; label: string; active: boolean; disabled?: boolean }) {
  const base =
    'block w-full text-sm px-3 py-2 rounded-md border transition-colors';
  const activeCls = 'bg-indigo-50 border-indigo-200 text-indigo-800';
  const idleCls = 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50';
  const disabledCls = 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed';

  if (props.disabled) {
    return <div className={`${base} ${disabledCls}`} title="Coming soon">{props.label}</div>;
  }

  return (
    <Link to={props.to} className={`${base} ${props.active ? activeCls : idleCls}`}>
      {props.label}
    </Link>
  );
}

export function ConsoleShell({
  title,
  subtitle,
  userLabel,
  superAdmin,
  onSignOut,
  onGoAdminUsers,
  children,
}: Props) {
  const loc = useLocation();

  const isDecks = loc.pathname === '/' || loc.pathname.startsWith('/decks');
  const isAdminUsers = loc.pathname.startsWith('/admin/users');

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
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
                Admin
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
      <div className="max-w-6xl mx-auto px-4 py-6 flex gap-4">
        {/* Sidebar */}
        <aside className="hidden md:block w-56 shrink-0">
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-3 space-y-2">
            <div className="text-xs font-semibold text-slate-500 px-1">Navigation</div>

            <NavItem to="/" label="Decks" active={isDecks} />
            <NavItem to="/publishing" label="Publishing" active={loc.pathname.startsWith('/publishing')} disabled />
            <NavItem to="/analytics" label="Analytics" active={loc.pathname.startsWith('/analytics')} disabled />

            {superAdmin ? (
              <>
                <div className="pt-2 text-xs font-semibold text-slate-500 px-1">Admin</div>
                <NavItem to="/admin/users" label="Users & Permissions" active={isAdminUsers} />
                <NavItem to="/admin/system" label="System" active={loc.pathname.startsWith('/admin/system')} disabled />
              </>
            ) : null}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 space-y-4">{children}</main>
      </div>
    </div>
  );
}