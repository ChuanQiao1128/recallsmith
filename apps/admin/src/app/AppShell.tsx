import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useMemo } from 'react'
import { Toaster } from 'sonner'
import { LayoutDashboard, Layers, Settings as SettingsIcon } from 'lucide-react'

/** ===== 本地 Mock 数据存储（localStorage） ===== */
export type Deck = {
  id: string
  slug: string
  title: string
  latestVersion?: string
  totalCards: number
  draftCount: number
  updatedAt: string
  lastPublishedAt?: string
  createdAt: string
}
export type Card = {
  id: string
  stableUid: string
  keyPoint: string
  frontMd: string
  backMd: string
  tags: string[]
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  updatedAt: string
  createdAt: string
}

const LS_DECKS = 'rs_mock_decks'
const LS_CARDS = (deckId: string) => `rs_mock_cards:${deckId}`

export const mock = {
  getDecks(): Deck[] {
    try { return JSON.parse(localStorage.getItem(LS_DECKS) ?? '[]') } catch { return [] }
  },
  setDecks(decks: Deck[]) { localStorage.setItem(LS_DECKS, JSON.stringify(decks)) },
  getDeck(deckId: string) { return this.getDecks().find(d => d.id === deckId) },
  upsertDeck(deck: Deck) {
    const list = this.getDecks()
    const i = list.findIndex(d => d.id === deck.id)
    if (i >= 0) list[i] = deck; else list.push(deck)
    this.setDecks(list)
  },
  getCards(deckId: string): Card[] {
    try { return JSON.parse(localStorage.getItem(LS_CARDS(deckId)) ?? '[]') } catch { return [] }
  },
  setCards(deckId: string, cards: Card[]) {
    localStorage.setItem(LS_CARDS(deckId), JSON.stringify(cards))
    const decks = this.getDecks()
    const i = decks.findIndex(d => d.id === deckId)
    if (i >= 0) {
      decks[i].draftCount = cards.length
      decks[i].updatedAt = new Date().toISOString()
      this.setDecks(decks)
    }
  },
  seedOnce() {
    const seeded = localStorage.getItem('rs_mock_seeded')
    if (seeded) return
    const deckId = crypto.randomUUID()
    const now = new Date().toISOString()
    const deck: Deck = {
      id: deckId,
      slug: 'js-core',
      title: 'JavaScript Core',
      latestVersion: '1.0.4',
      totalCards: 3,
      draftCount: 3,
      lastPublishedAt: now,
      updatedAt: now,
      createdAt: now,
    }
    this.setDecks([deck])
    localStorage.setItem('lastDeckId', deckId)
    // 三张示例卡
    const cards: Card[] = [
      {
        id: crypto.randomUUID(),
        stableUid: 'js.eventloop.micro-vs-macro.v1',
        keyPoint: 'Microtasks run before macrotasks within the same turn.',
        tags: ['JavaScript','event-loop'],
        difficulty: 'intermediate',
        frontMd: 'Explain microtasks vs macrotasks and their execution order.',
        backMd: `## KeyPoint
Microtasks run before macrotasks within the same event loop turn.

## Details
- **Microtasks**: Promise callbacks, MutationObserver.
- **Macrotasks**: setTimeout/setInterval, I/O, messageChannel.

## Example
\`\`\`js
console.log('A');
setTimeout(() => console.log('timeout'), 0);
Promise.resolve().then(() => console.log('micro'));
console.log('B');
// Output: A B micro timeout
\`\`\`

## Pitfalls
Large microtask chains can starve rendering. Yield to the event loop when needed.`,
        createdAt: now, updatedAt: now
      },
      {
        id: crypto.randomUUID(),
        stableUid: 'react.reconciliation.keys.v1',
        keyPoint: 'Stable unique keys enable correct list reconciliation.',
        tags: ['React','reconciliation','keys'],
        difficulty: 'intermediate',
        frontMd: 'Why are stable keys important in React lists?',
        backMd: `Keys give identity to list items so React can do stable reconciliation.

\`\`\`tsx
{items.map(item => <li key={item.id}>{item.text}</li>)}
\`\`\`

Avoid using indices as keys to prevent state leaks on reorder.`,
        createdAt: now, updatedAt: now
      },
      {
        id: crypto.randomUUID(),
        stableUid: 'dotnet.async.await.vs-taskrun.v1',
        keyPoint: 'Prefer async/await for I/O; avoid Task.Run in web request pipeline.',
        tags: ['C#','.NET','async'],
        difficulty: 'intermediate',
        frontMd: 'When should you use async/await vs Task.Run in ASP.NET Core?',
        backMd: `Use **async/await** for I/O-bound. Avoid \`Task.Run\` on the request path.

\`\`\`csharp
// GOOD
await httpClient.GetAsync(url);

// AVOID in request path
var result = await Task.Run(() => HeavyCpu());
\`\`\``,
        createdAt: now, updatedAt: now
      }
    ]
    this.setCards(deckId, cards)
    localStorage.setItem('rs_mock_seeded', '1')
  }
}

/** ===== 布局壳 ===== */
function AppShell() {
  const { pathname } = useLocation()

  // 首次载入注入 mock 数据
  useEffect(() => { mock.seedOnce() }, [])

  const navItems = useMemo(() => ([
    { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { to: '/decks', label: 'Decks', icon: <Layers className="w-4 h-4" /> },
    { to: '/settings', label: 'Settings', icon: <SettingsIcon className="w-4 h-4" /> }, // 占位
  ]), [])

  return (
    <div className="min-h-screen bg-brand-bg text-brand-fg">
      {/* TopBar */}
      <header className="h-14 border-b bg-white">
        <div className="h-full flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="w-2 h-5 bg-blue-600 rounded-sm" />
            <span className="font-semibold">RecallSmith Admin</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="badge">Dev</span>
            <div className="w-8 h-8 rounded-full bg-slate-200" />
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex">
        {/* SideNav (desktop) */}
        <aside className="w-60 border-r bg-white hidden md:flex md:flex-col">
          <nav className="p-2">
            {navItems.map(n => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 h-10 rounded hover:bg-slate-100 ${isActive ? 'bg-slate-100 font-medium border-l-4 border-blue-500' : ''}`
                }
              >
                {n.icon}<span>{n.label}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Main */}
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>

      <Toaster richColors closeButton />
    </div>
  )
}

export default AppShell
