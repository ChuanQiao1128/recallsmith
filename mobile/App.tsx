// mobile/App.tsx
import React from 'react';
import {
  SafeAreaView,
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { jsCoreStarterMock } from './src/mock/jsCoreStarterMock';
import type { CardExport } from './src/types/deckExport.ts';

export default function App() {
  const deck = jsCoreStarterMock;
  const cards = deck.Cards;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Deck 头部信息 */}
        <View style={styles.header}>
          <Text style={styles.deckTitle}>{deck.Title}</Text>
          <Text style={styles.deckMeta}>
            slug: <Text style={styles.mono}>{deck.Slug}</Text> ·{' '}
            {deck.Locale} ·{' '}
            {deck.DeckType === 1 ? 'Starter Deck' : 'Paid Deck'}
          </Text>
          <Text style={styles.deckMeta}>
            Total cards: {deck.TotalCards} · Free cards:{' '}
            {deck.FreeCardCount}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Cards (mock)</Text>

        {/* 简单用 FlatList 列出所有卡片 */}
        <FlatList<CardExport>
          data={cards}
          keyExtractor={item => item.StableUid}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.cardItem}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardOrder}>
                  #{item.OrderInDeck}
                </Text>
                <Text style={styles.cardDifficulty}>
                  {item.Difficulty === 1
                    ? 'Easy'
                    : item.Difficulty === 2
                    ? 'Medium'
                    : 'Hard'}
                </Text>
                {item.CodeLanguage ? (
                  <Text style={styles.cardLang}>
                    {item.CodeLanguage}
                  </Text>
                ) : null}
              </View>

              <Text style={styles.cardQuestion}>
                {item.Question}
              </Text>

              {item.Explanation ? (
                <Text style={styles.cardExplanation}>
                  {item.Explanation}
                </Text>
              ) : null}

              {item.CodeSnippet ? (
                <ScrollView
                  style={styles.codeContainer}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                >
                  <Text style={styles.codeText}>
                    {item.CodeSnippet}
                  </Text>
                </ScrollView>
              ) : null}
            </View>
          )}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a', // slate-900
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  header: {
    marginBottom: 16,
  },
  deckTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: 'white',
  },
  deckMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#cbd5f5',
  },
  mono: {
    fontFamily: 'Menlo',
  },
  sectionTitle: {
    marginTop: 8,
    marginBottom: 8,
    fontSize: 16,
    fontWeight: '600',
    color: '#e5e7eb',
  },
  listContent: {
    paddingBottom: 24,
  },
  cardItem: {
    backgroundColor: '#020617',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardOrder: {
    fontSize: 12,
    color: '#9ca3af',
    marginRight: 8,
  },
  cardDifficulty: {
    fontSize: 12,
    color: '#fbbf24',
    marginRight: 8,
  },
  cardLang: {
    fontSize: 11,
    color: '#a5b4fc',
  },
  cardQuestion: {
    fontSize: 14,
    fontWeight: '500',
    color: '#e5e7eb',
    marginBottom: 4,
  },
  cardExplanation: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 6,
  },
  codeContainer: {
    backgroundColor: '#020617',
    borderRadius: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: '#111827',
  },
  codeText: {
    fontSize: 12,
    color: '#e5e7eb',
    fontFamily: 'Menlo',
  },
});