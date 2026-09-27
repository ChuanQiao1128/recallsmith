// src/features/automation/DeckSelect.tsx
//
// The deck select of the Automation tabs, with the deck list it offers. A
// failed fetch is shown beside the select with a Retry, never swallowed: an
// empty select with no explanation left the owner unable to satisfy "Choose a
// deck." (B07 frontend-console-10).
import { useEffect, useState } from 'react';

import { fetchDecks } from '../../api/authoring';
import { INPUT_CLASS } from '../../components/console/consoleStyles';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import type { Deck } from '../../types/deck';

type DeckState = { forNonce: number | null; decks: Deck[]; error: string | null };

export function DeckSelect({
  id,
  value,
  onChange,
  emptyLabel,
  className = INPUT_CLASS,
  invalid = false,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  emptyLabel: string;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<DeckState>({ forNonce: null, decks: [], error: null });

  useEffect(() => {
    let cancelled = false;
    const forNonce = nonce;
    async function run() {
      const res = await fetchDecks();
      if (cancelled) return;
      if (!res.success || !res.data) {
        setState(prev => ({
          forNonce,
          decks: prev.decks,
          error: res.error?.message ?? 'The deck list could not be loaded.',
        }));
        return;
      }
      setState({ forNonce, decks: res.data, error: null });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const loading = state.forNonce !== nonce;

  return (
    <>
      <select
        id={id}
        className={className}
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
      >
        <option value="">{emptyLabel}</option>
        {state.decks.map(d => (
          <option key={d.id} value={String(d.id)}>
            {d.slug}
          </option>
        ))}
      </select>
      {state.error ? (
        <div className="mt-2">
          <Callout tone="danger" role="alert">
            <span>Could not load the deck list: {state.error} </span>
            <Button variant="outline" size="xs" loading={loading} onClick={() => setNonce(n => n + 1)}>
              Retry loading decks
            </Button>
          </Callout>
        </div>
      ) : null}
    </>
  );
}
