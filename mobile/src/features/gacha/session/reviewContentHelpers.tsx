import React from 'react';
import { Alert, Text, View } from 'react-native';
import type { CardExport, DeckExport } from '../../../types/deckExport';

export function showTrialUpsellDialog(
  navigation: any,
  opts: { deckTitle: string; previewCount: number; totalCards: number },
) {
  const { deckTitle, previewCount, totalCards } = opts;

  Alert.alert(
    '免费试学已完成',
    `你已学完「${deckTitle}」可免费学习的前 ${previewCount} 张卡片（共 ${totalCards} 张）。\n\n你仍可无限复习这 ${previewCount} 张。\n升级 Premium 解锁剩余内容并继续进度。`,
    [
      { text: '继续复习', style: 'cancel' },
      { text: '升级 Premium', onPress: () => navigation.navigate('Paywall' as any) },
    ],
  );
}

export function buildPreviewDeck(deck: DeckExport, previewLimit: number): DeckExport {
  const cards = deck.Cards ?? [];
  const take = Math.max(0, Math.min(previewLimit, cards.length));
  return {
    ...deck,
    Cards: cards.slice(0, take),
    TotalCards: Math.min(deck.TotalCards ?? cards.length, take),
  };
}

export function buildCardMap(deck: DeckExport): Map<string, CardExport> {
  const map = new Map<string, CardExport>();
  for (const card of deck.Cards ?? []) map.set(card.StableUid, card);
  return map;
}

export function sortCards(deck: DeckExport): CardExport[] {
  return [...(deck.Cards ?? [])].sort((a, b) => a.OrderInDeck - b.OrderInDeck);
}

export function normalizeCodeLanguage(lang?: string | null): string {
  const l = (lang ?? '').trim().toLowerCase();
  if (!l) return 'text';

  if (l === 'ts') return 'typescript';
  if (l === 'tsx') return 'tsx';
  if (l === 'js') return 'javascript';
  if (l === 'jsx') return 'jsx';
  if (l === 'py') return 'python';
  if (l === 'rb') return 'ruby';
  if (l === 'sh' || l === 'shell') return 'bash';
  if (l === 'yml') return 'yaml';
  if (l === 'c++') return 'cpp';
  if (l === 'c#' || l === 'cs' || l === 'csharp') return 'csharp';

  return l;
}

export function renderSimpleMarkdown(text: string, stylesObj: any) {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];

  lines.forEach((line, idx) => {
    const raw = line.trimEnd();
    if (raw.trim().length === 0) {
      nodes.push(<View key={`sp-${idx}`} style={{ height: 8 }} />);
      return;
    }

    const bullet = raw.startsWith('- ') || raw.startsWith('* ') ? raw.slice(2).trim() : null;

    if (bullet !== null) {
      nodes.push(
        <View key={`b-${idx}`} style={stylesObj.mdBulletRow}>
          <Text style={stylesObj.mdBullet}>•</Text>
          <Text style={stylesObj.mdText}>{bullet}</Text>
        </View>,
      );
      return;
    }

    nodes.push(
      <Text key={`p-${idx}`} style={stylesObj.mdText}>
        {raw}
      </Text>,
    );
  });

  return nodes;
}
