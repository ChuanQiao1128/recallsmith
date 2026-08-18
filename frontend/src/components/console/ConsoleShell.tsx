// src/components/console/ConsoleShell.tsx

import { Link } from 'react-router-dom';

type Props = {
  title: string;
  subtitle?: string;
  userLabel: string;
  superAdmin: boolean;
  onSignOut: () => void;

  // ---------------------------------------------------------------------
  // DESTINATIONS, NOT HANDLERS. THE DIFFERENCE IS THE WHOLE POINT.
  // ---------------------------------------------------------------------
  // These were `onGoDecks?: () => void` and friends, and every caller passed
  // `() => navigate('/…')`. Rendered as <button onClick={…}> that produced
  // controls which look like links, sit where links sit, and are not links:
  // cmd-click and middle-click open nothing, "copy link address" is absent,
  // the status bar shows no target, and a screen reader announces "button"
  // for a thing whose only effect is to change the page.
  //
  // Passing the path instead lets the shell render <Link>, which restores all
  // of that for free — react-router's Link is an <a href> that also intercepts
  // the plain left-click, so modified clicks fall through to the browser.
  //
  // An undefined href means "this session has nowhere to go here", and the
  // control is not rendered at all. That is the same three-state shape the
  // callbacks had; only the payload changed.
  decksHref?: string;
  contentIntelligenceHref?: string;
  adminUsersHref?: string;

  children: React.ReactNode;
};

/** One spelling for all three, so a link cannot drift away from its neighbours. */
const NAV_LINK_CLASS =
  'text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50';

export function ConsoleShell({
  title,
  subtitle,
  userLabel,
  superAdmin,
  onSignOut,
  decksHref,
  contentIntelligenceHref,
  adminUsersHref,
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
            {/* A landmark, so "skip to the console's sections" is answerable by
                assistive technology without reading the header out. It needs the
                three links to be adjacent, which is why the user pill now sits
                after them rather than between Content Intelligence and Admin
                Management — that position was incidental, and identity beside
                Sign out is where a shell usually puts it. */}
            <nav aria-label="Console sections" className="flex items-center gap-2 flex-wrap">
              {decksHref ? (
                <Link to={decksHref} className={NAV_LINK_CLASS}>
                  Decks
                </Link>
              ) : null}

              {contentIntelligenceHref ? (
                <Link to={contentIntelligenceHref} className={NAV_LINK_CLASS}>
                  Content Intelligence
                </Link>
              ) : null}

              {superAdmin && adminUsersHref ? (
                <Link
                  to={adminUsersHref}
                  className={NAV_LINK_CLASS}
                  title="Manage users and permissions (super_admin only)"
                >
                  Admin Management
                </Link>
              ) : null}
            </nav>

            <span className="text-xs px-2 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
              {userLabel}
            </span>

            {/* Stays a button, and must: signing out is an action with a side
                effect, not a destination. */}
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
