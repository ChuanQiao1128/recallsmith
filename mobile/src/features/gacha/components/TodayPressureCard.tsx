import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { TodayCounts } from '../contracts';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';

const TODAY_PRESSURE_TOKENS = {
  card: colors.softCream,
  metricNormal: colors.softLavender,
  metricElite: colors.parchmentBgDeep,
  metricBoss: colors.softPeach,
  metricTotal: colors.softMist,
  metricBorder: colors.hairline,
} as const;

export function TodayPressureCard(props: { counts: TodayCounts; selectedDeckTitle: string | null }) {
  const { counts, selectedDeckTitle } = props;
  const { width } = useWindowDimensions();
  const useCompactMetrics = width < 390;
  const metricSizeStyle = useCompactMetrics ? styles.metricCompact : styles.metricWide;
  // Every tile describes the selected deck, so the collapse does too. Owned
  // is the superset (a due, new or learned card is an owned card), and the
  // cross-deck due total that used to sit here belongs to reminders and the
  // header line, not to whether this deck has cards in it.
  const nothingYet =
    counts.selectedOwned === 0 &&
    counts.selectedDue === 0 &&
    counts.selectedNew === 0 &&
    counts.selectedMastered === 0;

  return (
    <View style={styles.card}>
      <Text style={styles.title} numberOfLines={2}>
        Today
      </Text>
      <Text style={styles.subtitle} numberOfLines={1}>
        {selectedDeckTitle ?? 'No active deck selected'}
      </Text>

      {nothingYet ? (
        <Text testID="home-today-empty" style={styles.subtitle} numberOfLines={2}>
          Nothing to review yet — open a pack to get your first cards.
        </Text>
      ) : (
        <View testID="home-today-count-grid" style={styles.row}>
          <View testID="home-today-count-normal" style={[styles.metric, metricSizeStyle, styles.metricNormal]}>
            <Text style={styles.metricValue} numberOfLines={1}>
              {counts.selectedDue}
            </Text>
            <Text style={styles.metricLabel} numberOfLines={1}>
              Due
            </Text>
          </View>
          <View testID="home-today-count-elite" style={[styles.metric, metricSizeStyle, styles.metricElite]}>
            <Text style={styles.metricValue} numberOfLines={1}>
              {counts.selectedNew}
            </Text>
            <Text style={styles.metricLabel} numberOfLines={1}>
              New
            </Text>
          </View>
          <View testID="home-today-count-boss" style={[styles.metric, metricSizeStyle, styles.metricBoss]}>
            <Text style={styles.metricValue} numberOfLines={1}>
              {counts.selectedMastered}
            </Text>
            <Text style={styles.metricLabel} numberOfLines={1}>
              Learned
            </Text>
          </View>
          {/* testID kept from the "Total" era (docs/delivery/r16-issues pin it); the tile now
              reads the selected deck's owned cards. The all-deck due sum it used to show was
              taken for the deck size ("0 Total" on a 441-card deck). */}
          <View testID="home-today-count-total" style={[styles.metric, metricSizeStyle, styles.metricTotal]}>
            <Text style={styles.metricValue} numberOfLines={1}>
              {counts.selectedOwned}
            </Text>
            <Text style={styles.metricLabel} numberOfLines={1}>
              Owned
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Tightened: less padding, smaller numbers, lighter shadow — fits on screen
  // alongside the bigger pack hero without crowding.
  card: {
    borderRadius: 18,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    backgroundColor: TODAY_PRESSURE_TOKENS.card,
    borderWidth: 1,
    borderColor: TODAY_PRESSURE_TOKENS.metricBorder,
    shadowColor: colors.ink,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    marginBottom: spacing.xs,
  },
  title: { fontSize: typography.bodySmall, fontWeight: '800', color: colors.ink },
  subtitle: { marginTop: 2, fontSize: typography.caption, color: colors.inkSecondary },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, justifyContent: 'space-between' },
  metric: {
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: TODAY_PRESSURE_TOKENS.metricBorder,
    alignItems: 'center',
  },
  metricWide: { flex: 1, minWidth: 0 },
  metricCompact: { width: '48%' },
  metricNormal: { backgroundColor: TODAY_PRESSURE_TOKENS.metricNormal },
  metricElite: { backgroundColor: TODAY_PRESSURE_TOKENS.metricElite },
  metricBoss: { backgroundColor: TODAY_PRESSURE_TOKENS.metricBoss },
  metricTotal: { backgroundColor: TODAY_PRESSURE_TOKENS.metricTotal },
  metricValue: { fontSize: typography.title3, fontWeight: '900', color: colors.ink },
  metricLabel: { marginTop: 2, fontSize: typography.caption, fontWeight: '800', color: colors.inkSecondary, letterSpacing: 0.5 },
});

export default TodayPressureCard;
