import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { MOCK_DRAW_RESULTS } from '../mock/draw';

const SPARKS = Array.from({ length: 18 }, (_, index) => ({
  left: `${8 + ((index * 21) % 82)}%`,
  top: `${4 + ((index * 13) % 64)}%`,
  size: index % 3 === 0 ? 6 : 3,
  amber: index % 4 === 0,
}));

type Props = NativeStackScreenProps<RootStackParamList, 'DrawResult'>;

function deriveCardTag(question: string) {
  const q = question.toLowerCase();
  if (q.includes('middleware') || q.includes('asp.net')) return 'ASP.NET CORE';
  if (q.includes('dependency injection') || q.includes('lifetimes')) return 'ARCHITECTURE';
  if (q.includes('iqueryable') || q.includes('ienumerable') || q.includes('linq')) return 'LINQ';
  if (q.includes('dbcontext')) return 'EF CORE';
  if (q.includes('configureawait') || q.includes('async')) return 'ASYNC / AWAIT';
  if (q.includes('iam') || q.includes('sqs') || q.includes('sns')) return 'AWS';
  return 'CORE';
}

function buildStarRow(difficulty: number) {
  return Array.from({ length: 5 }, (_, index) => (index < difficulty ? '★' : '☆')).join('');
}

export function DrawResultScreen({ navigation, route }: Props) {
  const slug = route.params.slug;
  const drawResult = route.params.drawResult ?? MOCK_DRAW_RESULTS;
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const raritySummary = useMemo(() => {
    const leg = drawResult.cards.filter((card) => card.rarity === 'LEG').length;
    const rar = drawResult.cards.filter((card) => card.rarity === 'RAR').length;
    const com = drawResult.cards.filter((card) => card.rarity === 'COM').length;
    return { leg, rar, com };
  }, [drawResult.cards]);

  const featuredCard = useMemo(() => {
    return (
      drawResult.cards.find((card) => card.rarity === 'LEG') ??
      drawResult.cards.find((card) => card.rarity === 'RAR') ??
      drawResult.cards[0] ??
      null
    );
  }, [drawResult.cards]);

  const selectedCard = drawResult.cards.find((card) => card.stableUid === selectedCardId) ?? null;

  const deckLabel = slug === 'aws' ? 'AWS SAA' : 'C# Interview';

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#0B1030', '#11173D', '#F4E8CC']} locations={[0, 0.42, 1]} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.heroShell}>
            <View pointerEvents="none" style={styles.sparkLayer}>
              {SPARKS.map((spark, index) => (
                <View
                  key={`spark-${index}`}
                  style={[
                    styles.spark,
                    {
                      left: spark.left as any,
                      top: spark.top as any,
                      width: spark.size,
                      height: spark.size,
                      borderRadius: spark.size,
                      backgroundColor: spark.amber ? '#E8B85A' : '#C9ADF7',
                      shadowColor: spark.amber ? '#E8B85A' : '#C9ADF7',
                    },
                  ]}
                />
              ))}
            </View>

            <Text style={styles.eyebrow}>Reward draw result · {drawResult.seedLabel ?? 'seed #----'}</Text>
            <Text style={styles.title}>{drawResult.cards.length} drawn card{drawResult.cards.length === 1 ? '' : 's'} ready for your next study loop</Text>
            <Text style={styles.body}>{deckLabel} · {raritySummary.leg} LEG · {raritySummary.rar} RAR · {raritySummary.com} COM · pity now at {drawResult.pityAfter}/10.</Text>

            {featuredCard ? (
              <Pressable
                style={({ pressed }) => [
                  styles.featuredCard,
                  featuredCard.rarity === 'LEG' ? styles.featuredLeg : featuredCard.rarity === 'RAR' ? styles.featuredRar : styles.featuredCom,
                  pressed && styles.pressed,
                ]}
                onPress={() => setSelectedCardId(featuredCard.stableUid)}
              >
                <Text style={styles.featuredBadge}>{featuredCard.rarity === 'LEG' ? 'Top reward' : featuredCard.rarity === 'RAR' ? 'Highlighted reward' : 'First reward'}</Text>
                <Text style={styles.featuredQuestion}>{featuredCard.question}</Text>
                <Text style={styles.featuredMeta}>{deriveCardTag(featuredCard.question)} · {buildStarRow(featuredCard.difficulty)} · tap for closer detail</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.summaryRow}>
            <Text style={[styles.summaryChip, styles.summaryChipLeg]}>{raritySummary.leg} LEG</Text>
            <Text style={[styles.summaryChip, styles.summaryChipRar]}>{raritySummary.rar} RAR</Text>
            <Text style={[styles.summaryChip, styles.summaryChipCom]}>{raritySummary.com} COM</Text>
          </View>

          <View style={styles.gridWrap}>
            {drawResult.cards.map((card, index) => (
              <Pressable
                key={`${card.stableUid}-${card.question}`}
                onPress={() => setSelectedCardId(card.stableUid)}
                style={[
                  styles.card,
                  index === 0 && styles.cardTall,
                  card.rarity === 'LEG' ? styles.legCard : card.rarity === 'RAR' ? styles.rarCard : styles.comCard,
                ]}
              >
                <Text style={styles.cardRarity}>{card.rarity}</Text>
                <Text style={styles.cardTag}>{deriveCardTag(card.question)}</Text>
                <Text style={styles.cardTitle} numberOfLines={index === 0 ? 3 : 2}>{card.question}</Text>
                <Text style={styles.cardMeta}>{buildStarRow(card.difficulty)}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.buttonStack}>
            <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={() => navigation.navigate('Level', { slug, source: 'draw', cardIds: drawResult.cards.map((card) => card.stableUid) })}>
              <Text style={styles.primaryButtonText}>Start studying drawn cards</Text>
            </Pressable>

            <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]} onPress={() => navigation.navigate('Deck', { slug })}>
              <Text style={styles.secondaryButtonText}>View library first</Text>
            </Pressable>

            <Pressable style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]} onPress={() => navigation.navigate('Home')}>
              <Text style={styles.ghostButtonText}>Back to Home</Text>
            </Pressable>
          </View>
        </ScrollView>

        <Modal transparent animationType="fade" visible={!!selectedCard} onRequestClose={() => setSelectedCardId(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={[styles.modalRarity, selectedCard?.rarity === 'LEG' ? styles.modalRarityLeg : selectedCard?.rarity === 'RAR' ? styles.modalRarityRar : styles.modalRarityCom]}>{selectedCard?.rarity}</Text>
              <Text style={styles.modalTitle}>{selectedCard?.question}</Text>
              <Text style={styles.modalBody}>{deriveCardTag(selectedCard?.question ?? '')} · {buildStarRow(selectedCard?.difficulty ?? 0)} · This reveal layer keeps the draw feeling premium before the full library detail takes over.</Text>
              <Pressable style={styles.primaryButton} onPress={() => setSelectedCardId(null)}>
                <Text style={styles.primaryButtonText}>Close detail</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default DrawResultScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#070A1F' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 34 },
  heroShell: {
    borderRadius: 28,
    padding: 20,
    backgroundColor: 'rgba(11,16,48,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(245,236,196,0.12)',
    overflow: 'hidden',
  },
  sparkLayer: { ...StyleSheet.absoluteFillObject },
  spark: {
    position: 'absolute',
    shadowOpacity: 0.9,
    shadowRadius: 12,
  },
  eyebrow: { color: '#E8B85A', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, fontFamily: 'Courier' },
  title: { marginTop: 10, fontSize: 30, lineHeight: 36, fontWeight: '900', color: '#F8EFD2' },
  body: { marginTop: 10, fontSize: 13, lineHeight: 19, color: '#D6C79A' },
  featuredCard: {
    marginTop: 18,
    borderRadius: 24,
    padding: 18,
    minHeight: 220,
    justifyContent: 'flex-end',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  featuredLeg: { backgroundColor: '#C8883A' },
  featuredRar: { backgroundColor: '#4C3E80' },
  featuredCom: { backgroundColor: '#6A5A43' },
  featuredBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.18)',
    color: '#FFF5E6',
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
  },
  featuredQuestion: { marginTop: 14, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#FFF9F1' },
  featuredMeta: { marginTop: 10, fontSize: 12, color: 'rgba(255,249,241,0.82)', fontWeight: '700' },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, marginBottom: 14 },
  summaryChip: {
    marginRight: 8,
    marginBottom: 8,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
  },
  summaryChipLeg: { backgroundColor: '#F9E8C4', color: '#A66F26' },
  summaryChipRar: { backgroundColor: '#E8E0F0', color: '#6E4C9F' },
  summaryChipCom: { backgroundColor: '#EFE6CC', color: '#8C7A5B' },
  gridWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: {
    width: '48%',
    borderRadius: 20,
    padding: 14,
    minHeight: 126,
    marginBottom: 12,
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  cardTall: { width: '100%', minHeight: 150 },
  comCard: { backgroundColor: 'rgba(239,230,204,0.94)', borderColor: 'rgba(140,122,91,0.18)' },
  rarCard: { backgroundColor: 'rgba(232,224,240,0.96)', borderColor: 'rgba(110,76,159,0.16)' },
  legCard: { backgroundColor: 'rgba(249,232,196,0.98)', borderColor: 'rgba(200,136,58,0.18)' },
  cardRarity: { fontSize: 11, fontWeight: '900', color: '#5A4630' },
  cardTag: { marginTop: 6, fontSize: 10, fontWeight: '800', color: '#8C7A5B', letterSpacing: 0.7 },
  cardTitle: { marginTop: 10, fontSize: 14, lineHeight: 19, fontWeight: '800', color: '#2A2218' },
  cardMeta: { marginTop: 10, fontSize: 11, color: '#6B5A45' },
  buttonStack: { marginTop: 10 },
  primaryButton: {
    borderRadius: 16,
    backgroundColor: '#C8883A',
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#C8883A',
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  secondaryButton: {
    marginTop: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.72)',
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.08)',
  },
  secondaryButtonText: { color: '#2A2218', fontSize: 14, fontWeight: '800' },
  ghostButton: {
    marginTop: 10,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(11,16,48,0.24)',
  },
  ghostButtonText: { color: '#F8EFD2', fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.92 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', borderRadius: 24, padding: 20, backgroundColor: '#FAF3E0' },
  modalRarity: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.1 },
  modalRarityLeg: { color: '#A66F26' },
  modalRarityRar: { color: '#6E4C9F' },
  modalRarityCom: { color: '#8C7A5B' },
  modalTitle: { marginTop: 10, fontSize: 22, lineHeight: 28, fontWeight: '900', color: '#2A2218' },
  modalBody: { marginTop: 8, fontSize: 13, lineHeight: 19, color: '#5A4B38' },
});
