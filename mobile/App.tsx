// mobile/App.tsx
import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { jsCoreStarterMock } from './src/mock/jsCoreStarterMock';
import type { DeckExport } from './src/types/deckExport';
import type { CardExport } from './src/types/deckExport';
import type { CardProgress } from './src/review/model';
import {
  isDue,
  formatDateKey,
  INTERVALS_DAYS,
} from './src/review/model';
import { loadDeckProgress } from './src/review/storage';

// 辅助：根据 stableUid 找到卡片内容
function buildCardMap(deck: DeckExport): Map<string, CardExport> {
  const map = new Map<string, CardExport>();
  for (const card of deck.Cards) {
    map.set(card.StableUid, card);
  }
  return map;
}

interface ReviewSummary {
  todayDueCards: CardExport[];
  upcomingCounts: { dateKey: string; count: number }[];
}

function computeReviewSummary(
  deck: DeckExport,
  progress: CardProgress[],
  now: Date,
): ReviewSummary {
  const cardMap = buildCardMap(deck);

  // 今天应复习的卡片
  const todayDue: CardExport[] = [];

  // 未来 7 天日历
  const upcomingMap = new Map<string, number>();

  // 今天的日期 key
  const todayKey = formatDateKey(now);

  // 我们只看未来 7 天（包括今天）
  const daysToShow = 7;

  for (let i = 0; i < daysToShow; i++) {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + i);
    const key = formatDateKey(d);
    upcomingMap.set(key, 0);
  }

  for (const p of progress) {
    const card = cardMap.get(p.stableUid);
    if (!card) {
      continue;
    }

    const next = new Date(p.nextReviewAt);
    const nextKey = formatDateKey(next);

    // 今天要复习？
    if (isDue(p, now)) {
      todayDue.push(card);
    }

    // 在未来 7 天内的统计划入日历
    if (upcomingMap.has(nextKey)) {
      const prev = upcomingMap.get(nextKey) ?? 0;
      upcomingMap.set(nextKey, prev + 1);
    }
  }

  const upcomingList: { dateKey: string; count: number }[] = [];
  for (let i = 0; i < daysToShow; i++) {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + i);
    const key = formatDateKey(d);
    upcomingList.push({
      dateKey: key,
      count: upcomingMap.get(key) ?? 0,
    });
  }

  return {
    todayDueCards: todayDue,
    upcomingCounts: upcomingList,
  };
}

export default function App() {
  const deck = jsCoreStarterMock;

  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<CardProgress[]>([]);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const now = new Date();
      const p = await loadDeckProgress(deck);
      if (cancelled) return;

      const s = computeReviewSummary(deck, p, now);

      setProgress(p);
      setSummary(s);
      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [deck]);

  const now = new Date();

  if (loading || !summary) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#a5b4fc" />
          <Text style={styles.loadingText}>Preparing your reviews...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { todayDueCards, upcomingCounts } = summary;

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

        {/* 今日复习总览 */}
        <View style={styles.todayBox}>
          <Text style={styles.todayTitle}>Today&apos;s Reviews</Text>
          <Text style={styles.todayCount}>
            {todayDueCards.length} card
            {todayDueCards.length === 1 ? '' : 's'} due today
          </Text>
          <Text style={styles.todayDate}>
            {now.toDateString()} · Interval stages:{' '}
            {INTERVALS_DAYS.join(', ')} days
          </Text>
        </View>

        {/* 小日历（未来 7 天） */}
        <Text style={styles.sectionTitle}>Next 7 days</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.calendarScroll}
        >
          {upcomingCounts.map(({ dateKey, count }, index) => {
            const label =
              index === 0
                ? 'Today'
                : index === 1
                ? 'Tomorrow'
                : `+${index}d`;
            return (
              <View key={dateKey} style={styles.calendarItem}>
                <Text style={styles.calendarLabel}>{label}</Text>
                <Text style={styles.calendarDate}>{dateKey}</Text>
                <Text style={styles.calendarCount}>
                  {count} card{count === 1 ? '' : 's'}
                </Text>
              </View>
            );
          })}
        </ScrollView>

        {/* 今日应复习卡片列表（只显示问题和难度） */}
        <Text style={styles.sectionTitle}>Cards due today</Text>
        {todayDueCards.length === 0 ? (
          <Text style={styles.emptyText}>
            🎉 No reviews due today. You can add more cards later.
          </Text>
        ) : (
          <FlatList<CardExport>
            data={todayDueCards}
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
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#020617', // slate-950
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#020617',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#e5e7eb',
  },
  header: {
    marginBottom: 12,
  },
  deckTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: 'white',
  },
  deckMeta: {
    marginTop: 4,
    fontSize: 12,
    color: '#9ca3af',
  },
  mono: {
    fontFamily: 'Menlo',
  },
  todayBox: {
    backgroundColor: '#0f172a',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 12,
  },
  todayTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#e5e7eb',
  },
  todayCount: {
    marginTop: 4,
    fontSize: 14,
    color: '#a5b4fc',
  },
  todayDate: {
    marginTop: 4,
    fontSize: 12,
    color: '#9ca3af',
  },
  sectionTitle: {
    marginTop: 8,
    marginBottom: 4,
    fontSize: 14,
    fontWeight: '600',
    color: '#e5e7eb',
  },
  calendarScroll: {
    marginBottom: 12,
  },
  calendarItem: {
    width: 90,
    backgroundColor: '#020617',
    borderRadius: 8,
    padding: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    alignItems: 'center',
  },
  calendarLabel: {
    fontSize: 12,
    color: '#e5e7eb',
    marginBottom: 2,
  },
  calendarDate: {
    fontSize: 11,
    color: '#9ca3af',
    marginBottom: 4,
  },
  calendarCount: {
    fontSize: 14,
    fontWeight: '500',
    color: '#a5b4fc',
  },
  listContent: {
    paddingBottom: 24,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 16,
  },
  cardItem: {
    backgroundColor: '#020617',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
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
  },
});