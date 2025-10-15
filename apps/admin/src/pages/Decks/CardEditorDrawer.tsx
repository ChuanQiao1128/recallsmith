import Drawer from '../../components/Drawer'
import Button from '../../components/Button'
import { Input, Textarea } from '../../components/Input'
import MarkdownPreview from '../../components/MarkdownPreview'
import { useState, useEffect } from 'react'
import { useStableUid } from '../../hooks/useStableUid'

export type CardDraft = {
  id?: string
  stableUid: string
  keyPoint: string
  tagsCsv: string
  difficulty: 'beginner'|'intermediate'|'advanced'
  frontMd: string
  backMd: string
}

export default function CardEditorDrawer({
  open, onClose, onSave, deckSlug, initial
}:{
  open: boolean
  onClose: ()=>void
  onSave: (card: CardDraft)=>void
  deckSlug: string
  initial?: Partial<CardDraft>
}) {
  const [state, setState] = useState<CardDraft>({
    stableUid: initial?.stableUid ?? '',
    keyPoint: initial?.keyPoint ?? '',
    tagsCsv: initial?.tagsCsv ?? '',
    difficulty: initial?.difficulty ?? 'intermediate',
    frontMd: initial?.frontMd ?? '',
    backMd: initial?.backMd ?? '',
    id: initial?.id
  })
  const gen = useStableUid()

  useEffect(()=>{
    if (!state.stableUid) {
      const uid = gen(deckSlug, state.keyPoint, state.frontMd)
      setState(s => ({...s, stableUid: uid}))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckSlug])

  function regenerate() {
    const uid = gen(deckSlug, state.keyPoint, state.frontMd)
    setState(s => ({...s, stableUid: uid}))
  }

  function save() {
    if (!state.keyPoint || !state.frontMd || !state.backMd) return
    onSave(state)
  }

  return (
    <Drawer open={open} onClose={onClose} title="Card Editor"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save}>Save</Button>
      </>}
    >
      <div className="flex flex-col md:flex-row">
        <div className="md:w-1/2 p-4 border-r space-y-3">
          <div>
            <div className="text-sm text-muted mb-1">Stable UID</div>
            <div className="flex gap-2">
              <Input value={state.stableUid} onChange={e=> setState(s=> ({...s, stableUid: e.target.value}))} className="flex-1" />
              <Button variant="ghost" onClick={regenerate}>Regenerate</Button>
            </div>
          </div>

          <div>
            <div className="text-sm text-muted mb-1">Key Point</div>
            <Input value={state.keyPoint} onChange={e=> setState(s=> ({...s, keyPoint: e.target.value}))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-sm text-muted mb-1">Tags (CSV)</div>
              <Input value={state.tagsCsv} onChange={e=> setState(s=> ({...s, tagsCsv: e.target.value}))} placeholder="JavaScript,event-loop" />
            </div>
            <div>
              <div className="text-sm text-muted mb-1">Difficulty</div>
              <select value={state.difficulty} onChange={e=> setState(s=> ({...s, difficulty: e.target.value as any}))}
                className="input w-full">
                <option value="beginner">beginner</option>
                <option value="intermediate">intermediate</option>
                <option value="advanced">advanced</option>
              </select>
            </div>
          </div>

          <div>
            <div className="text-sm text-muted mb-1">Front (Markdown)</div>
            <Textarea rows={6} value={state.frontMd} onChange={e=> setState(s=> ({...s, frontMd: e.target.value}))} />
          </div>

          <div>
            <div className="text-sm text-muted mb-1">Back (Markdown)</div>
            <Textarea rows={10} value={state.backMd} onChange={e=> setState(s=> ({...s, backMd: e.target.value}))} />
          </div>
        </div>

        <div className="md:w-1/2 p-4">
          <div className="text-sm text-muted mb-2">Preview</div>
          <MarkdownPreview markdown={`# ${state.keyPoint || 'Title'}
${state.frontMd ? '---\n' + state.frontMd : '_No front_'}
\n\n${state.backMd ? state.backMd : '_No back_'}
`} />
        </div>
      </div>
    </Drawer>
  )
}
