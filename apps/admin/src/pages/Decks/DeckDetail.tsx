import PageHeader from '../../components/PageHeader';
import { useParams, Navigate, Routes, Route, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getDeck } from '../../api/admin';
import DraftCards from './DraftCards';
import Publish from './Publish';
import Settings from './Settings';
import { Tabs } from '@mantine/core';


export default function DeckDetail() {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const { data: deck } = useQuery({ 
    queryKey: ['deck', deckId], 
    queryFn: () => getDeck(deckId!),
    enabled: !!deckId
  });

  if (!deckId) return <Navigate to="/decks" replace />;

  return (
    <>
      <PageHeader
        title={deck?.title ?? 'Deck'}
        crumbs={[{ label: 'Decks', href: '/decks' }, { label: deck?.slug ?? deckId }]}
        right={<button onClick={() => navigate('/decks')} className="btn">Back</button>}
      />

      <Tabs defaultValue="draft" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="draft">Draft Cards</Tabs.Tab>
          <Tabs.Tab value="publish">Publish</Tabs.Tab>
          <Tabs.Tab value="settings">Settings</Tabs.Tab>
        </Tabs.List>

        <Routes>
          <Route path="/" element={<DraftCards deckId={deckId} deckSlug={deck?.slug} />} />
          <Route path="draft" element={<DraftCards deckId={deckId} deckSlug={deck?.slug} />} />
          <Route path="publish" element={<Publish deckId={deckId} />} />
          <Route path="settings" element={<Settings deckId={deckId} />} />
          <Route path="*" element={<DraftCards deckId={deckId} deckSlug={deck?.slug} />} />
        </Routes>
      </Tabs>
    </>
  );
}