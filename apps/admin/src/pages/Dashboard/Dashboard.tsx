import PageHeader from '../../components/PageHeader'
import { mock } from '../../app/AppShell'

export default function Dashboard() {
  const decks = mock.getDecks()
  const totalCards = decks.reduce((acc, d) => acc + d.draftCount, 0)
  return (
    <div>
      <PageHeader title="Dashboard" />
      <div className="grid md:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="text-sm text-muted">Decks</div>
          <div className="text-2xl font-semibold mt-1">{decks.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-muted">Draft Cards</div>
          <div className="text-2xl font-semibold mt-1">{totalCards}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-muted">Last Published</div>
          <div className="text-sm mt-1">{decks[0]?.lastPublishedAt?.slice(0,19) ?? '-'}</div>
        </div>
      </div>
    </div>
  )
}
