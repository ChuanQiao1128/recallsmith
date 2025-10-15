import { useParams } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Button from '../../components/Button'
import { Textarea, Input } from '../../components/Input'
import { mock } from '../../app/AppShell'
import { useMemo, useState } from 'react'
import Badge from '../../components/Badge'
import { toast } from 'sonner'

function nextPatch(v?: string) {
  if (!v) return '1.0.0'
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return '1.0.0'
  const [_, a,b,c] = m
  return `${a}.${b}.${Number(c)+1}`
}

export default function Publish() {
  const { deckId } = useParams()
  const deck = deckId ? mock.getDeck(deckId) : undefined
  const cards = deckId ? mock.getCards(deckId) : []
  const [version, setVersion] = useState(nextPatch(deck?.latestVersion))
  const [changelog, setChangelog] = useState('')

  const diff = useMemo(()=>{
    const added = Math.max(0, cards.length - (deck?.totalCards ?? 0))
    const modified = added>0 ? 0 : (cards.length>0 ? 1 : 0) // mock: 简化
    const deleted = Math.max(0, (deck?.totalCards ?? 0) - cards.length)
    return { added, modified, deleted }
  }, [cards.length, deck?.totalCards])

  if (!deck || !deckId) return <div className="text-rose-600">Deck not found</div>

  function publish() {
    // mock：发布 = 把 draft 计数变为正式
    deck.latestVersion = version
    deck.totalCards = cards.length
    deck.lastPublishedAt = new Date().toISOString()
    mock.upsertDeck(deck)
    toast.success(`Published ${version}`)
  }

  return (
    <div>
      <PageHeader title="Publish & Versions">
        <Button onClick={publish}>Publish</Button>
      </PageHeader>

      {/* 摘要 */}
      <div className="grid md:grid-cols-3 gap-4 mb-4">
        <div className="card p-4">
          <div className="text-sm text-muted mb-1">Added</div>
          <div className="text-xl font-semibold"><Badge color="green">{diff.added}</Badge></div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-muted mb-1">Modified</div>
          <div className="text-xl font-semibold"><Badge color="blue">{diff.modified}</Badge></div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-muted mb-1">Deleted</div>
          <div className="text-xl font-semibold"><Badge color="rose">{diff.deleted}</Badge></div>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div>
          <div className="text-sm text-muted mb-1">Version</div>
          <Input value={version} onChange={e=> setVersion(e.target.value)} placeholder="x.y.z" />
        </div>
        <div>
          <div className="text-sm text-muted mb-1">Changelog</div>
          <Textarea rows={6} value={changelog} onChange={e=> setChangelog(e.target.value)} />
        </div>
        <div className="text-sm text-muted">
          Current latest: <span className="font-mono">{deck.latestVersion ?? '-'}</span>
        </div>
      </div>
    </div>
  )
}
