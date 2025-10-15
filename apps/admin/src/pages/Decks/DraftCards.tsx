import { useParams } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Toolbar from '../../components/Toolbar'
import Button from '../../components/Button'
import Table from '../../components/Table'
import type { Column } from '../../components/Table'
import Badge from '../../components/Badge'
import { mock } from '../../app/AppShell'
import type { Card } from '../../app/AppShell'
import CardEditorDrawer from './CardEditorDrawer'
import type { CardDraft } from './CardEditorDrawer'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

export default function DraftCards() {
  const { deckId } = useParams()
  const deck = deckId ? mock.getDeck(deckId) : undefined
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Card | null>(null)

  const cards = useMemo(() => deckId ? mock.getCards(deckId) : [], [deckId])

  if (!deck || !deckId) return <div className="text-rose-600">Deck not found</div>

  const columns: Column<Card>[] = [
    { header: '#', render: (_c, i) => i+1, className: 'w-10' },
    { header: 'KeyPoint', render: c => <div className="font-medium">{c.keyPoint}</div> },
    { header: 'Stable UID', render: c => <div className="text-muted">{c.stableUid}</div> },
    { header: 'Tags', render: c => <div className="flex flex-wrap gap-1">{c.tags.map(t=> <Badge key={t}>{t}</Badge>)}</div> },
    { header: 'Difficulty', render: c => {
      const color = c.difficulty==='beginner' ? 'green' : c.difficulty==='advanced' ? 'violet' : 'blue'
      return <Badge color={color as 'green' | 'violet' | 'blue'}>{c.difficulty}</Badge>
    }},
    { header: 'Updated', render: c => <div className="text-muted">{c.updatedAt.slice(0,19)}</div> },
    { header: 'Actions', className: 'text-right', render: c => (
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={()=> { setEditing(c); setOpen(true) }}>Edit</Button>
        <Button variant="danger" onClick={()=> del(c.id)}>Delete</Button>
      </div>
    )},
  ]

  function del(cardId: string) {
    if (!deckId) return
    const arr = cards.filter(x => x.id !== cardId)
    mock.setCards(deckId, arr)
    toast.success('Deleted')
  }

  function onSave(d: CardDraft) {
    if (!deckId) return
    if (editing) {
      const arr = cards.map(x => x.id===editing.id ? {
        ...x,
        stableUid: d.stableUid,
        keyPoint: d.keyPoint,
        tags: d.tagsCsv.split(',').map(s=>s.trim()).filter(Boolean),
        difficulty: d.difficulty,
        frontMd: d.frontMd,
        backMd: d.backMd,
        updatedAt: new Date().toISOString()
      } : x)
      mock.setCards(deckId, arr)
      toast.success('Updated card')
    } else {
      const now = new Date().toISOString()
      const c: Card = {
        id: crypto.randomUUID(),
        stableUid: d.stableUid,
        keyPoint: d.keyPoint,
        tags: d.tagsCsv.split(',').map(s=>s.trim()).filter(Boolean),
        difficulty: d.difficulty,
        frontMd: d.frontMd,
        backMd: d.backMd,
        createdAt: now,
        updatedAt: now
      }
      mock.setCards(deckId, [...cards, c])
      toast.success('Created card')
    }
    setOpen(false)
    setEditing(null)
  }

  return (
    <div>
      <PageHeader title="Draft Cards">
        <Button onClick={()=> { setEditing(null); setOpen(true) }}>New Card</Button>
      </PageHeader>
      <Toolbar>
        <input className="input w-64" placeholder="Search (mock)" />
      </Toolbar>
      <Table columns={columns} data={cards} rowKey={(r)=> r.id} />
      <CardEditorDrawer
        open={open}
        onClose={()=> { setOpen(false); setEditing(null) }}
        onSave={onSave}
        deckSlug={deck.slug}
        initial={editing ? {
          id: editing.id,
          stableUid: editing.stableUid,
          keyPoint: editing.keyPoint,
          tagsCsv: editing.tags.join(','),
          difficulty: editing.difficulty,
          frontMd: editing.frontMd,
          backMd: editing.backMd
        } : {}}
      />
    </div>
  )
}
