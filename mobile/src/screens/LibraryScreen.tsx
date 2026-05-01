import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { LIBRARY_SNAPSHOT } from '../mock/library';
import { POOL_OVERVIEW } from '../mock/pools';
import { ActionButton, MetricCard, MicroChip, ParchmentScaffold, SectionCard } from '../components/ParchmentScaffold';
import { colors } from '../theme/colors';


type Props = NativeStackScreenProps<RootStackParamList, 'Library'>;

export function LibraryScreen({ navigation }: Props) {
  const stats = useMemo(
    () => [
      { title: 'Owned', value: String(LIBRARY_SNAPSHOT.ownedCount) },
      { title: 'Due', value: String(LIBRARY_SNAPSHOT.dueCount) },
      { title: 'Mastered', value: String(LIBRARY_SNAPSHOT.masteredCount) },
    ],
    [],
  );
  const statusChips = useMemo(
    () => [
      `New ${LIBRARY_SNAPSHOT.cards.filter((card) => card.mastery === 'new').length}`,
      `Learning ${LIBRARY_SNAPSHOT.cards.filter((card) => card.mastery === 'learning').length}`,
      `Mastered ${LIBRARY_SNAPSHOT.cards.filter((card) => card.mastery === 'mastered').length}`,
    ],
    [],
  );

  return (
    <ParchmentScaffold
      eyebrow="Library"
      title="Your card library"
      body="See what you already own, what needs attention today, and where to drill in next without turning this tab into a second home page."
      chips={['Owned cards', 'Secondary system', 'Collection']}
    >
      <View style={styles.metricsRow}>
        {stats.map((item, index) => (
          <MetricCard key={item.title} value={item.value} label={item.title} accent={index === 1 ? colors.ink : colors.gold} />
        ))}
      </View>

      <SectionCard
        kicker="Overview"
        title="Collection snapshot"
        body="Use the library to scan what is owned, what is due, and which cards are already settling into mastery."
      >
        <View style={styles.poolRow}>
          {statusChips.map((label, index) => (
            <MicroChip key={label} label={label} active={index === 1} />
          ))}
        </View>
      </SectionCard>

      <SectionCard kicker="Filters" title="Browse by status" body="Start with a simple inventory lens, then narrow by rarity, tag, or audience only when you need it.">
        <View style={styles.actionsRow}>
          <View style={styles.actionItem}>
            <ActionButton label="Filter library" variant="secondary" onPress={() => navigation.navigate('SortFilter')} />
          </View>
          <View style={styles.actionItem}>
            <ActionButton
              label="Pool progress"
              variant="ghost"
              onPress={() => navigation.navigate('PoolOverview', { poolId: LIBRARY_SNAPSHOT.poolId })}
            />
          </View>
        </View>
      </SectionCard>

      <SectionCard kicker="Pools" title="Active pool" body="Keep one fast way to understand which pool these owned cards belong to before drilling into tags and individual cards.">
        <View style={styles.poolRow}>
          {Object.values(POOL_OVERVIEW).map((pool) => (
            <MicroChip key={pool.poolId} label={pool.title} active={pool.poolId === LIBRARY_SNAPSHOT.poolId} />
          ))}
        </View>
      </SectionCard>

      <SectionCard kicker="Owned cards" title="Owned cards" body="Each card keeps the scan order simple: rarity first, then topic, then where that card sits right now in your study loop.">
        <View style={styles.grid}>
          {LIBRARY_SNAPSHOT.cards.map((card) => (
            <Pressable key={card.id} style={styles.card} onPress={() => navigation.navigate('CardDetail', { cardId: card.id })}>
              <Text style={styles.cardRarity}>{card.rarity}</Text>
              <Text style={styles.cardTitle}>{card.keyword}</Text>
              <View style={styles.cardMetaRow}>
                <Text style={styles.cardMeta}>{card.tag}</Text>
                <Text style={styles.cardMastery}>{card.mastery}</Text>
              </View>
              <View style={styles.cardAccent} />
            </Pressable>
          ))}
        </View>
      </SectionCard>
    </ParchmentScaffold>
  );
}

export default LibraryScreen;

const styles = StyleSheet.create({
  metricsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionItem: { flex: 1 },
  poolRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 },
  card: {
    width: '47%',
    minHeight: 150,
    borderRadius: 22,
    padding: 14,
    backgroundColor: '#FFF9EF',
    borderWidth: 1,
    borderColor: 'rgba(200,136,58,0.14)',
  },
  cardRarity: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8C7A5B',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  cardTitle: {
    marginTop: 10,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    color: '#2A2218',
  },
  cardMetaRow: {
    marginTop: 18,
    gap: 4,
  },
  cardMeta: {
    fontSize: 12,
    color: '#6B7280',
  },
  cardMastery: {
    fontSize: 12,
    fontWeight: '700',
    color: '#C8883A',
    textTransform: 'capitalize',
  },
  cardAccent: {
    marginTop: 'auto',
    width: 34,
    height: 3,
    borderRadius: 999,
    backgroundColor: '#C8883A',
  },
});
