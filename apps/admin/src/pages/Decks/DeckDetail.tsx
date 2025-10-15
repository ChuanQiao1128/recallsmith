import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Button from '../../components/Button'
import { mock } from '../../app/AppShell'

export default function DeckDetail() {
  const { deckId } = useParams()
  const nav = useNavigate()
  const deck = deckId ? mock.getDeck(deckId) : undefined

  if (!deck) {
    return <div className="text-rose-600">Deck not found</div>
  }

  return (
    <div>
      <PageHeader title={deck.title}>
        <Button variant="ghost" onClick={()=> nav('/decks')}>Back</Button>
        <Button onClick={()=> nav('publish')}>Publish</Button>
      </PageHeader>

      <div className="mb-4 border-b">
        <nav className="flex gap-4">
          {[
            { to: 'draft', label: 'Draft Cards' },
            { to: 'publish', label: 'Publish & Versions' },
            { to: 'settings', label: 'Settings' },
          ].map(t => (
            <NavLink key={t.to} to={t.to}
              className={({isActive})=>`h-10 inline-flex items-center border-b-2 ${isActive?'border-blue-600 text-blue-700':'border-transparent text-muted'} px-1`}>
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <Outlet />
    </div>
  )
}
