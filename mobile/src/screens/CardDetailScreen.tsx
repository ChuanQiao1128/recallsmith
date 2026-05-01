import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { LIBRARY_SNAPSHOT, TAG_BREAKDOWN } from '../mock/library';

type Props = NativeStackScreenProps<RootStackParamList, 'CardDetail'>;

export function CardDetailScreen({ navigation, route }: Props) {
  const card = LIBRARY_SNAPSHOT.cards.find((item) => item.id === route.params.cardId) ?? LIBRARY_SNAPSHOT.cards[0];
  const related = TAG_BREAKDOWN.filter((item) => item.tag !== card.tag).slice(0, 2);

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#FAF3E0', '#F5F3FF']} style={styles.gradient}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.eyebrow}>Card details</Text>
          <Text style={styles.title}>{card.keyword}</Text>
          <Text style={styles.body}>{card.rarity} · {card.tag} · {card.mastery}</Text>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Study status</Text>
            <Text style={styles.panelBody}>Recent ratings: Again → Hard → Good → Easy. Use this card to understand whether it is still shaky, settling, or nearly mastered.</Text>
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Why this card matters</Text>
            <Text style={styles.panelBody}>Treat card detail like a real reference stop: enough context to remind the learner what this card is about, why it keeps returning, and which neighboring topics it should unlock next.</Text>
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Related tags</Text>
            {related.map((item) => (
              <Text key={item.tag} style={styles.relatedRow}>{item.tag} · {item.owned}/{item.total}</Text>
            ))}
          </View>

          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Library')}>
            <Text style={styles.primaryButtonText}>Back to library</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate('TagExplorer', { poolId: 'csharp' })}>
            <Text style={styles.secondaryButtonText}>Back to tag coverage</Text>
          </Pressable>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

export default CardDetailScreen;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF3E0' },
  gradient: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  eyebrow: { fontSize: 11, fontWeight: '800', color: '#C8883A', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#2A2218' },
  body: { marginTop: 10, fontSize: 14, lineHeight: 20, color: '#5A4B38', textTransform: 'capitalize' },
  panel: { marginTop: 16, borderRadius: 18, padding: 16, backgroundColor: 'rgba(255,255,255,0.92)' },
  panelTitle: { fontSize: 15, fontWeight: '800', color: '#2A2218' },
  panelBody: { marginTop: 6, fontSize: 13, lineHeight: 19, color: '#6B7280' },
  relatedRow: { marginTop: 8, fontSize: 12, color: '#5A4B38' },
  primaryButton: { marginTop: 20, borderRadius: 14, backgroundColor: '#2A2218', paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: { marginTop: 10, borderRadius: 14, backgroundColor: 'rgba(42,34,24,0.08)', paddingVertical: 16, alignItems: 'center' },
  secondaryButtonText: { color: '#2A2218', fontSize: 14, fontWeight: '800' },
});