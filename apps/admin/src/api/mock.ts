import type { Card, Deck, PublishInfo } from '../types';

type Store = {
  decks: Deck[];
  cards: Record<string, Card[]>;
  publishes: Record<string, PublishInfo[]>;
};

const KEY = 'rs_admin_mock';

function load(): Store {
  const raw = localStorage.getItem(KEY);
  if (!raw) return { decks: [], cards: {}, publishes: {} };
  try { return JSON.parse(raw) as Store; } catch { return { decks: [], cards: {}, publishes: {} }; }
}
function save(s: Store) { localStorage.setItem(KEY, JSON.stringify(s)); }

function uuid() {
  // 简易 uuid
  return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random()*16)|0, v = c === 'x' ? r : (r&0x3|0x8); return v.toString(16);
  });
}

export const mock = {
  listDecks(): Deck[] {
    return load().decks;
  },
  getDeck(id: string): Deck | undefined {
    return load().decks.find(d => d.id === id);
  },
  createDeck(input: { slug: string; title: string; locale?: string }): { deckId: string } {
    const s = load();
    const id = uuid();
    const deck: Deck = { id, slug: input.slug, title: input.title, locale: input.locale, createdAt: new Date().toISOString() };
    s.decks.unshift(deck);
    save(s);
    return { deckId: id };
  },
  updateDeck(id: string, patch: Partial<Deck>): Deck | undefined {
    const s = load();
    const i = s.decks.findIndex(d => d.id === id);
    if (i < 0) return undefined;
    s.decks[i] = { ...s.decks[i], ...patch };
    save(s);
    return s.decks[i];
  },
  listCards(deckId: string): Card[] {
    const s = load();
    return s.cards[deckId]?.slice().sort((a,b) => a.createdAt.localeCompare(b.createdAt)) ?? [];
  },
  upsertCard(input: Omit<Card, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): { cardId: string; stableUid: string } {
    const s = load();
    const id = input.id ?? uuid();
    const now = new Date().toISOString();
    if (!s.cards[input.deckId]) s.cards[input.deckId] = [];
    const idx = s.cards[input.deckId].findIndex(c => c.id === id);
    const card: Card = {
      id,
      deckId: input.deckId,
      stableUid: input.stableUid,
      frontMd: input.frontMd,
      backMd: input.backMd,
      keyPoint: input.keyPoint,
      tags: input.tags,
      difficulty: input.difficulty,
      createdAt: idx >= 0 ? s.cards[input.deckId][idx].createdAt : now,
      updatedAt: now,
    };
    if (idx >= 0) s.cards[input.deckId][idx] = card; else s.cards[input.deckId].push(card);
    save(s);
    return { cardId: id, stableUid: card.stableUid };
  },
  deleteCard(deckId: string, cardId: string) {
    const s = load();
    if (!s.cards[deckId]) return;
    s.cards[deckId] = s.cards[deckId].filter(c => c.id !== cardId);
    save(s);
  },
  publish(deckId: string, version: string): { version: string; totalCards: number; publishedAt: string } {
    const s = load();
    const cards = s.cards[deckId] ?? [];
    const info: PublishInfo = { version, totalCards: cards.length, publishedAt: new Date().toISOString() };
    if (!s.publishes[deckId]) s.publishes[deckId] = [];
    s.publishes[deckId].push(info);
    save(s);
    return info;
  },
  listPublishes(deckId: string): PublishInfo[] {
    return load().publishes[deckId] ?? [];
  },
};