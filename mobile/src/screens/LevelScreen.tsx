import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import RatingBar from '../features/gacha/components/RatingBar';
import { advanceStage, applyLevelRating, createLevelSessionState } from '../features/gacha/session/levelFlow';
import { buildSettlementVm } from '../features/gacha/settlement/settlementVm';
import { buildMockSessionCards } from '../mock/session';

type Props = NativeStackScreenProps<RootStackParamList, 'Level'>;

const STAGE_META = {
  q: {
    title: 'Stage 1/3 · Question',
    kicker: 'Think first, reveal second.',
    progress: 1,
  },
  a: {
    title: 'Stage 2/3 · Answer',
    kicker: 'Linear disclosure: answer, code, then application.',
    progress: 2,
  },
  irl: {
    title: 'Stage 3/3 · IRL',
    kicker: 'Judge how recall holds up in a real engineering frame.',
    progress: 3,
  },
} as const;

const RARITY_ACCENT = {
  COM: '#6E7C91',
  RAR: '#7C5CE0',
  LEG: '#C8883A',
} as const;

function formatTag(tag: string) {
  return tag.replace(/[-_]/g, ' / ').toUpperCase();
}

function deckTitleForSlug(slug: string) {
  return slug === 'aws' ? 'AWS SAA' : 'C# Interview';
}

function buildStarRow(difficulty: number) {
  return Array.from({ length: 5 }, (_, index) => (index < difficulty ? '●' : '○')).join('');
}

export function LevelScreen({ navigation, route }: Props) {
  const slug = route.params.slug;
  const source = route.params.source;
  const cards = useMemo(() => buildMockSessionCards(route.params.cardIds), [route.params.cardIds]);
  const [started, setStarted] = useState(false);
  const [state, setState] = useState(createLevelSessionState());
  const [showHint, setShowHint] = useState(false);
  const [showLeech, setShowLeech] = useState(false);
  const [demoteText, setDemoteText] = useState<string | null>(null);

  const currentCard = cards[state.cardIndex];
  const stageMeta = STAGE_META[state.stage];
  const deckTitle = deckTitleForSlug(slug);
  const progressRatio = cards.length ? (state.cardIndex + stageMeta.progress / 3) / cards.length : 0;
  const currentAccent = currentCard ? RARITY_ACCENT[currentCard.rarity] : '#C8883A';

  function moveForward() {
    setShowHint(false);
    setState((prev) => ({ ...prev, stage: advanceStage(prev.stage) }));
  }

  function handleRate(rating: 'again' | 'hard' | 'good' | 'easy') {
    const next = applyLevelRating({ state, cards, rating });
    setState(next.state);
    setShowHint(false);
    if (next.triggeredLeech) setShowLeech(true);
    if (next.demoted) setDemoteText('This card dropped back to new-card status. You did not lose it — it will cycle back later.');
    if (next.finished) {
      const vm = buildSettlementVm({
        deckTitle,
        cards,
        ratings: next.state.ratings,
      });
      navigation.replace('Settlement', {
        slug,
        deckTitle,
        sessionDone: next.state.completedCount,
        rewardPulls: vm.pullsAwarded,
        masteredCount: vm.masteredCount,
      });
    }
  }

  if (!started) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient colors={['#F6EFD9', '#F4EBDD', '#EFE6D1']} style={styles.gradient}>
          <ScrollView contentContainerStyle={styles.container}>
            <View style={styles.shell}>
              <View style={styles.topStripe} />
              <Text style={styles.eyebrow}>Level briefing</Text>
              <Text style={styles.title}>Today you have {cards.length} cards and about {Math.max(4, cards.length * 2)} focused minutes.</Text>
              <Text style={styles.body}>
                Source: {source === 'draw' ? 'Draw result' : 'Daily dose'} · The flow stays question first, answer second, then real-world framing before rating.
              </Text>

              <View style={styles.briefGrid}>
                <View style={styles.briefTile}>
                  <Text style={styles.briefLabel}>Route</Text>
                  <Text style={styles.briefValue}>{source === 'draw' ? 'New-card route' : 'Daily dose route'}</Text>
                </View>
                <View style={styles.briefTile}>
                  <Text style={styles.briefLabel}>Deck</Text>
                  <Text style={styles.briefValue}>{deckTitle}</Text>
                </View>
                <View style={styles.briefTile}>
                  <Text style={styles.briefLabel}>Cadence</Text>
                  <Text style={styles.briefValue}>Q → A → IRL</Text>
                </View>
              </View>

              <View style={styles.stageCard}>
                <Text style={styles.monoLabel}>SESSION MODE</Text>
                <Text style={styles.cardTitle}>Boss-first recall, parchment hierarchy, deliberate reveal.</Text>
                <Text style={styles.cardBody}>
                  Treat each card like a serious prompt, not a flashcard skim. Think out loud first, then reveal the answer and code, then rate the quality of your recall.
                </Text>
              </View>

              <Pressable style={styles.primaryButton} onPress={() => setStarted(true)}>
                <Text style={styles.primaryButtonText}>Start level</Text>
              </Pressable>
            </View>
          </ScrollView>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (!currentCard) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient colors={['#F6EFD9', '#F4EBDD', '#EFE6D1']} style={styles.gradient}>
          <View style={styles.emptyCenter}>
            <Text style={styles.emptyTitle}>No cards in this level</Text>
            <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Home')}>
              <Text style={styles.primaryButtonText}>Return home</Text>
            </Pressable>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#F6EFD9', '#F4EBDD', '#EFE6D1']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.shell}>
            <View style={[styles.topStripe, { backgroundColor: currentAccent }]} />

            <View style={styles.headerRow}>
              <View>
                <Text style={styles.eyebrow}>Level flow</Text>
                <Text style={styles.title}>{stageMeta.title}</Text>
                <Text style={styles.body}>{stageMeta.kicker}</Text>
              </View>
              <View style={styles.sessionBadge}>
                <Text style={styles.sessionBadgeText}>#{state.cardIndex + 1}</Text>
              </View>
            </View>

            <View style={styles.progressCard}>
              <View style={styles.progressRow}>
                <Text style={styles.progressMeta}>SESSION PROGRESS</Text>
                <Text style={styles.progressMeta}>{state.cardIndex + 1}/{cards.length} · {source === 'draw' ? 'Draw' : 'Daily dose'}</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(6, Math.min(100, progressRatio * 100))}%`, backgroundColor: currentAccent }]} />
              </View>
            </View>

            {demoteText ? <Text style={styles.toast}>{demoteText}</Text> : null}

            <View style={styles.stageCard}>
              <View style={styles.cardMetaRow}>
                <Text style={styles.monoLabel}>Stage {stageMeta.progress}/3 · {deckTitle}</Text>
                <View style={[styles.rarityBadge, { borderColor: currentAccent, backgroundColor: `${currentAccent}18` }]}>
                  <Text style={[styles.rarityBadgeText, { color: currentAccent }]}>{currentCard.rarity}</Text>
                </View>
              </View>

              <View style={styles.chipRow}>
                <View style={[styles.chip, styles.chipStrong, { borderColor: currentAccent, backgroundColor: `${currentAccent}16` }]}>
                  <Text style={[styles.chipText, { color: currentAccent }]}>⚔ {currentCard.rarity === 'LEG' ? 'BOSS' : 'FOCUS'}</Text>
                </View>
                <View style={styles.chip}>
                  <Text style={styles.chipText}>{formatTag(currentCard.tag)}</Text>
                </View>
                <View style={styles.chip}>
                  <Text style={styles.chipText}>Audience · {currentCard.audience.toUpperCase()}</Text>
                </View>
              </View>

              <View style={styles.topicRow}>
                <Text style={styles.topicKeyword}>{currentCard.question.split(/[?.!]/)[0]}</Text>
                <Text style={styles.starRow}>{buildStarRow(currentCard.difficulty)}</Text>
              </View>

              <View style={styles.questionPanel}>
                <Text style={styles.questionText}>{currentCard.question}</Text>
                <Text style={styles.questionHint}>Think first. Tap only after you have a spoken answer.</Text>
              </View>

              {state.stage === 'q' ? (
                <>
                  <View style={styles.calloutCard}>
                    <Text style={styles.calloutTitle}>Recall posture</Text>
                    <Text style={styles.calloutBody}>Explain the answer as if a hiring manager just asked you to defend it under pressure.</Text>
                  </View>
                  <Pressable style={styles.primaryButton} onPress={moveForward}>
                    <Text style={styles.primaryButtonText}>See answer</Text>
                  </Pressable>
                </>
              ) : null}

              {state.stage === 'a' ? (
                <>
                  <View style={styles.sectionBlock}>
                    <Text style={styles.sectionLabel}>ANSWER</Text>
                    <Text style={styles.sectionBody}>{currentCard.answer}</Text>
                  </View>

                  <View style={styles.codeCard}>
                    <View style={styles.codeHeader}>
                      <Text style={styles.codeLabel}>{currentCard.codeLanguage.toUpperCase()}</Text>
                      <Text style={styles.codeMeta}>Code cue</Text>
                    </View>
                    <Text style={styles.codeText}>{currentCard.code}</Text>
                  </View>

                  <View style={styles.calloutCard}> 
                    <Text style={styles.calloutTitle}>Next disclosure</Text>
                    <Text style={styles.calloutBody}>Move from textbook answer to how this failure mode or pattern surfaces in real engineering work.</Text>
                  </View>

                  <Pressable style={styles.primaryButton} onPress={moveForward}>
                    <Text style={styles.primaryButtonText}>Real-world check</Text>
                  </Pressable>
                </>
              ) : null}

              {state.stage === 'irl' ? (
                <>
                  <View style={styles.sectionBlock}> 
                    <Text style={styles.sectionLabel}>IRL FRAME</Text>
                    <Text style={styles.sectionBody}>{currentCard.irlPrompt}</Text>
                  </View>

                  <Pressable style={styles.secondaryButton} onPress={() => setShowHint((value) => !value)}>
                    <Text style={styles.secondaryButtonText}>{showHint ? 'Hide hint' : 'Show hint'}</Text>
                  </Pressable>

                  {showHint ? (
                    <View style={styles.hintCard}>
                      <Text style={styles.hintLabel}>INTERVIEW NUDGE</Text>
                      <Text style={styles.hint}>{currentCard.irlHint}</Text>
                    </View>
                  ) : null}

                  <View style={styles.ratingShell}>
                    <Text style={styles.ratingLabel}>GRADE THIS RECALL</Text>
                    <RatingBar onRate={handleRate} />
                  </View>
                </>
              ) : null}
            </View>
          </View>
        </ScrollView>

        <Modal transparent animationType="fade" visible={showLeech} onRequestClose={() => setShowLeech(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Leech warning</Text>
              <Text style={styles.modalBody}>This card is repeatedly getting stuck. Bury it briefly, keep going, or come back later with a fresh pass.</Text>
              <Pressable style={styles.primaryButton} onPress={() => setShowLeech(false)}>
                <Text style={styles.primaryButtonText}>Keep going</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default LevelScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F6EFD9' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28 },
  shell: {
    borderRadius: 28,
    backgroundColor: 'rgba(251,247,236,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(90,75,56,0.12)',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 20,
    shadowColor: '#7A6242',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  topStripe: {
    height: 4,
    borderRadius: 999,
    backgroundColor: '#C8883A',
    marginBottom: 14,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: '#7C6647',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontFamily: 'Courier',
  },
  title: { marginTop: 10, fontSize: 29, lineHeight: 36, fontWeight: '900', color: '#241D15' },
  body: { marginTop: 8, fontSize: 14, lineHeight: 21, color: '#5C4E3D' },
  sessionBadge: {
    minWidth: 44,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#2A2218',
    alignItems: 'center',
  },
  sessionBadgeText: { color: '#F8F1DE', fontSize: 14, fontWeight: '900', fontFamily: 'Courier' },
  progressCard: {
    marginTop: 18,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#F2E8D5',
    borderWidth: 1,
    borderColor: 'rgba(90,75,56,0.1)',
  },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  progressMeta: { fontSize: 11, color: '#75644F', fontWeight: '700', letterSpacing: 0.8, fontFamily: 'Courier' },
  progressTrack: { marginTop: 10, height: 8, borderRadius: 999, backgroundColor: '#DDD0B8', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  toast: {
    marginTop: 14,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(200,136,58,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(200,136,58,0.2)',
    color: '#3A2B18',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  briefGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  briefTile: {
    flexGrow: 1,
    minWidth: '30%',
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#F2E8D5',
    borderWidth: 1,
    borderColor: 'rgba(90,75,56,0.1)',
  },
  briefLabel: { fontSize: 10, color: '#7C6647', fontWeight: '800', letterSpacing: 1, fontFamily: 'Courier' },
  briefValue: { marginTop: 6, fontSize: 14, lineHeight: 19, color: '#241D15', fontWeight: '800' },
  stageCard: {
    marginTop: 18,
    borderRadius: 24,
    padding: 18,
    backgroundColor: '#FCF8EF',
    borderWidth: 1,
    borderColor: 'rgba(90,75,56,0.1)',
  },
  cardMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  monoLabel: { fontSize: 11, fontWeight: '800', color: '#7C6647', textTransform: 'uppercase', letterSpacing: 1.2, fontFamily: 'Courier' },
  rarityBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  rarityBadgeText: { fontSize: 11, fontWeight: '900', fontFamily: 'Courier' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#F2E8D5',
    borderWidth: 1,
    borderColor: 'rgba(90,75,56,0.1)',
  },
  chipStrong: { borderWidth: 1.2 },
  chipText: { fontSize: 11, color: '#5C4E3D', fontWeight: '800', letterSpacing: 0.5, fontFamily: 'Courier' },
  topicRow: { marginTop: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  topicKeyword: { flex: 1, fontSize: 15, color: '#625340', fontWeight: '800', fontFamily: 'Courier' },
  starRow: { fontSize: 13, color: '#C8883A', letterSpacing: 1.6, fontFamily: 'Courier' },
  questionPanel: {
    marginTop: 14,
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: '#F5EBD8',
    borderLeftWidth: 4,
    borderLeftColor: '#C8883A',
  },
  questionText: { fontSize: 22, lineHeight: 32, fontWeight: '900', color: '#241D15' },
  questionHint: { marginTop: 10, fontSize: 12, color: '#7A6A54', fontStyle: 'italic', textAlign: 'center' },
  calloutCard: {
    marginTop: 14,
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#F2E8D5',
    borderWidth: 1,
    borderColor: 'rgba(90,75,56,0.08)',
  },
  calloutTitle: { fontSize: 11, color: '#7C6647', fontWeight: '900', letterSpacing: 1, fontFamily: 'Courier' },
  calloutBody: { marginTop: 8, fontSize: 14, lineHeight: 21, color: '#5C4E3D' },
  cardTitle: { marginTop: 10, fontSize: 24, lineHeight: 31, fontWeight: '900', color: '#241D15' },
  cardBody: { marginTop: 12, fontSize: 14, lineHeight: 21, color: '#5C4E3D' },
  sectionBlock: {
    marginTop: 16,
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#F4EBDD',
    borderWidth: 1,
    borderColor: 'rgba(90,75,56,0.08)',
  },
  sectionLabel: { fontSize: 11, color: '#7C6647', fontWeight: '900', letterSpacing: 1, fontFamily: 'Courier' },
  sectionBody: { marginTop: 8, fontSize: 15, lineHeight: 23, color: '#342A1F' },
  codeCard: {
    marginTop: 14,
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#1D2433',
    borderWidth: 1,
    borderColor: '#32405B',
  },
  codeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  codeLabel: { fontSize: 11, fontWeight: '900', color: '#88C0FF', textTransform: 'uppercase', fontFamily: 'Courier' },
  codeMeta: { fontSize: 11, color: '#99A8C0', fontFamily: 'Courier' },
  codeText: { marginTop: 10, fontSize: 12, lineHeight: 19, color: '#F3F6FB', fontFamily: 'Courier' },
  hintCard: {
    marginTop: 12,
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#F2E8D5',
    borderWidth: 1,
    borderColor: 'rgba(200,136,58,0.2)',
  },
  hintLabel: { fontSize: 10, color: '#7C6647', fontWeight: '900', letterSpacing: 1, fontFamily: 'Courier' },
  hint: { marginTop: 6, fontSize: 13, lineHeight: 20, color: '#5C4E3D' },
  ratingShell: {
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: 'rgba(90,75,56,0.1)',
    paddingTop: 16,
  },
  ratingLabel: { fontSize: 11, color: '#7C6647', fontWeight: '900', letterSpacing: 1.1, fontFamily: 'Courier', marginBottom: 12 },
  primaryButton: {
    marginTop: 18,
    borderRadius: 14,
    backgroundColor: '#2A2218',
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#F8F1DE', fontSize: 15, fontWeight: '900', letterSpacing: 0.3 },
  secondaryButton: {
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: '#EFE5D1',
    borderWidth: 1,
    borderColor: 'rgba(90,75,56,0.14)',
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#2A2218', fontSize: 14, fontWeight: '800' },
  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: '#2A2218' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(24,18,10,0.38)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: {
    width: '100%',
    borderRadius: 24,
    padding: 18,
    backgroundColor: '#FCF8EF',
    borderWidth: 1,
    borderColor: 'rgba(90,75,56,0.1)',
  },
  modalTitle: { fontSize: 18, fontWeight: '900', color: '#241D15' },
  modalBody: { marginTop: 10, fontSize: 13, lineHeight: 20, color: '#5C4E3D' },
});
