import { useNavigate } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Toolbar from '../../components/Toolbar'
import Button from '../../components/Button'
import Table from '../../components/Table'
import type { Column } from '../../components/Table'
import Badge from '../../components/Badge'
import { mock } from '../../app/AppShell'
import type { Deck } from '../../app/AppShell'

export default function AllDecks() {
  const nav = useNavigate()
  const decks = mock.getDecks().sort((a,b)=> (b.updatedAt.localeCompare(a.updatedAt)))

  const columns: Column<Deck>[] = [
    { header: 'Name', render: d => <div className="font-medium">{d.title}</div> },
    { header: 'Slug', render: d => <div className="text-muted">{d.slug}</div> },
    { header: 'Latest', render: d => <div>{d.latestVersion ?? '-'}</div> },
    { header: 'Draft', render: d => <div>{d.draftCount}</div> },
    { header: 'Total', render: d => <div>{d.totalCards}</div> },
    { header: 'Last Published', render: d => <div className="text-muted">{d.lastPublishedAt?.slice(0,10) ?? '-'}</div> },
    { header: 'Updated', render: d => <div className="text-muted">{d.updatedAt.slice(0,10)}</div> },
    {
      header: 'Status',
      render: d => {
        const changed = d.draftCount !== d.totalCards
        return <Badge color={changed ? 'blue':'gray'}>{changed?'draft changed':'up-to-date'}</Badge>
      }
    },
    {
      header: 'Actions', className: 'text-right',
      render: d => (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={()=> nav(`/decks/${d.id}`)}>View</Button>
          <Button onClick={()=> nav(`/decks/${d.id}/publish`)}>Publish</Button>
        </div>
      )
    }
  ]

  function createDeckQuick() {
    const now = new Date().toISOString()
    const deck: Deck = {
      id: crypto.randomUUID(),
      slug: `deck-${Math.random().toString(36).slice(2,7)}`,
      title: 'New Deck',
      latestVersion: undefined,
      totalCards: 0,
      draftCount: 0,
      updatedAt: now,
      createdAt: now,
      lastPublishedAt: undefined
    }
    mock.upsertDeck(deck)
    localStorage.setItem('lastDeckId', deck.id)
    nav(`/decks/${deck.id}`)
  }

  return (
    <div>
      <PageHeader title="Decks">
        <Button onClick={createDeckQuick}>New Deck</Button>
      </PageHeader>
      <Toolbar>
        <input className="input w-64" placeholder="Search (mock - not wired)" />
      </Toolbar>
      <Table columns={columns} data={decks} />
    </div>
  )
}
