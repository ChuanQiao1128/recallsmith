import { useParams } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import { Input } from '../../components/Input'
import Button from '../../components/Button'
import { mock } from '../../app/AppShell'
import { useState } from 'react'
import { toast } from 'sonner'

export default function Settings() {
  const { deckId } = useParams()
  const deck = deckId ? mock.getDeck(deckId) : undefined
  const [slug, setSlug] = useState(deck?.slug ?? '')
  const [title, setTitle] = useState(deck?.title ?? '')

  if (!deck) return <div className="text-rose-600">Deck not found</div>

  function save() {
    mock.upsertDeck({...deck, slug, title })
    toast.success('Saved')
  }

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="card p-4 space-y-3 max-w-xl">
        <div>
          <div className="text-sm text-muted mb-1">Slug</div>
          <Input value={slug} onChange={e=> setSlug(e.target.value)} />
        </div>
        <div>
          <div className="text-sm text-muted mb-1">Title</div>
          <Input value={title} onChange={e=> setTitle(e.target.value)} />
        </div>
        <div className="flex justify-end">
          <Button onClick={save}>Save</Button>
        </div>
      </div>
    </div>
  )
}
