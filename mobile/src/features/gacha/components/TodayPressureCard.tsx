import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { TodayCounts } from '../contracts';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { typography } from '../../../theme/typography';
import { isLargeFontScale, useFontScale } from '../../../theme/dynamicType';

const TODAY_PRESSURE_TOKENS = {
  card: colors.softCream,
  metricNormal: colors.softLavender,
  metricElite: colors.parchmentBgDeep,
  metricBoss: colors.softPeach,
  metricTotal: colors.softMist,
  metricBorder: colors.hairline,
} as const;

export function TodayPressureCard(props: { counts: TodayCounts; selectedDeckTitle: string | null; compact?: boolean }) {
  const { counts, selectedDeckTitle } = props;
  const { width } = useWindowDimensions();
  const largeText = isLargeFontScale(useFontScale());
  const useCompactMetrics = width < 390 || largeText;
  const metricSizeStyle = styles.metricWide;
  // Every tile describes the selected deck, so the collapse does too. Collected
  // is the superset (a due, new or learned card is a collected card), and the
  // cross-deck due total that used to sit here belongs to reminders, not to
  // whether this deck has cards in it.
  const nothingYet =
    counts.selectedOwned === 0 &&
    counts.selectedDue === 0 &&
    counts.selectedNew === 0 &&
    counts.selectedMastered === 0;

  if (props.compact) return (
    <View testID="home-today-compact" style={styles.compactSummary}>
      <View testID="home-today-count-grid" style={[styles.compactRow, largeText && styles.largeTextRow]}>
        {renderGroups({ due: counts.selectedDue, fresh: counts.selectedNew,
          learned: counts.selectedMastered, collected: counts.selectedOwned }, styles.compactMetric, true, largeText, largeText)}
      </View>
    </View>
  );
  return (
    <View style={styles.card}>
      <Text style={styles.title} numberOfLines={2}>
        This pack
      </Text>
      <Text style={styles.subtitle} numberOfLines={largeText ? undefined : 1}>
        {selectedDeckTitle ?? 'No active deck selected'}
      </Text>

      {nothingYet ? (
        // The empty line takes the grid's height (an invisible copy of the tiles under it), so the
        // card is the same size for every pack and a swipe on Home moves nothing below it.
        <View style={styles.emptySlot}>
          {!largeText ? <View
            style={[styles.row, styles.spacer]}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {renderGroups({ due: 0, fresh: 0, learned: 0, collected: 0 }, metricSizeStyle, false, useCompactMetrics)}
          </View> : null}
          <View style={!largeText && styles.emptyOverlay}>
            <Text testID="home-today-empty" style={styles.subtitle} numberOfLines={largeText ? undefined : 2}>
              Nothing to review yet — open a pack to get your first cards.
            </Text>
          </View>
        </View>
      ) : (
        <View testID="home-today-count-grid" style={styles.row}>
          {renderGroups(
            {
              due: counts.selectedDue,
              fresh: counts.selectedNew,
              learned: counts.selectedMastered,
              collected: counts.selectedOwned,
            },
            metricSizeStyle,
            true,
            useCompactMetrics,
            largeText,
          )}
        </View>
      )}
    </View>
  );
}

type TileValues = { due: number; fresh: number; learned: number; collected: number };

function renderGroups(values: TileValues, metricSizeStyle: object, withIds: boolean, stacked = false, largeText = false) {
  const tiles = renderTiles(values, metricSizeStyle, withIds, largeText);
  return ['Ready now', 'Pack totals'].map((label, index) => (
    <View key={label} style={stacked ? styles.metricGroupStacked : styles.metricGroup}>
      <Text style={styles.metricGroupLabel}>{label}</Text>
      <View style={[styles.metricGroupRow, largeText && styles.largeTextRow]}>{tiles.slice(index * 2, index * 2 + 2)}</View>
    </View>
  ));
}

// The four tiles, in order. `withIds` is false for the invisible copy that holds the empty card's
// height, so tests and probes only ever find the real grid.
function renderTiles(values: TileValues, metricSizeStyle: object, withIds: boolean, largeText: boolean) {
  const tiles = [
    { id: 'normal', value: values.due, label: 'Due', scope: 'cards due now', tone: styles.metricNormal },
    { id: 'elite', value: values.fresh, label: 'New', scope: 'new cards available to learn', tone: styles.metricElite },
    { id: 'boss', value: values.learned, label: 'Learned', scope: 'cards learned in this pack, all time', tone: styles.metricBoss },
    // testID kept from the "Total" era (docs/delivery/r16-issues pin it); the tile now reads the
    // selected deck's owned cards, labelled Collected (R22 §5). The all-deck due sum it used to
    // show was taken for the deck size ("0 Total" on a 441-card deck).
    { id: 'total', value: values.collected, label: 'Collected', scope: 'cards collected in this pack, all time', tone: styles.metricTotal },
  ];
  return tiles.map((tile) => (
    <View
      key={tile.id}
      accessible={withIds}
      accessibilityLabel={withIds ? `${tile.value} ${tile.scope}` : undefined}
      testID={withIds ? `home-today-count-${tile.id}` : undefined}
      style={[styles.metric, metricSizeStyle, tile.tone, largeText && styles.metricLargeText]}
    >
      <Text style={styles.metricValue} numberOfLines={largeText ? undefined : 1}>
        {tile.value}
      </Text>
      <Text style={styles.metricLabel} numberOfLines={largeText ? undefined : 1}>
        {tile.label}
      </Text>
    </View>
  ));
}

const styles = StyleSheet.create({
  compactSummary: { marginBottom: 4 },
  compactRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  largeTextRow: { flexDirection: 'column' },
  metricLargeText: { flex: undefined, alignItems: 'stretch' },
  compactMetric: { flex: 1, minWidth: 0, paddingVertical: 4, paddingHorizontal: 2, borderRadius: 8 },
  metricGroup: { flex: 1, minWidth: 0 },
  metricGroupStacked: { width: '100%' },
  metricGroupRow: { flexDirection: 'row', gap: 6 },
  metricGroupLabel: { fontSize: typography.caption, fontWeight: '800', color: colors.inkSecondary, marginBottom: 4 },
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
  emptySlot: { position: 'relative' },
  spacer: { opacity: 0 },
  emptyOverlay: { position: 'absolute', top: 8, right: 0, bottom: 0, left: 0, justifyContent: 'center' },
  metric: {
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: TODAY_PRESSURE_TOKENS.metricBorder,
    alignItems: 'center',
  },
  metricWide: { flex: 1, minWidth: 0 },
  metricNormal: { backgroundColor: TODAY_PRESSURE_TOKENS.metricNormal },
  metricElite: { backgroundColor: TODAY_PRESSURE_TOKENS.metricElite },
  metricBoss: { backgroundColor: TODAY_PRESSURE_TOKENS.metricBoss },
  metricTotal: { backgroundColor: TODAY_PRESSURE_TOKENS.metricTotal },
  metricValue: { fontSize: typography.title3, fontWeight: '900', color: colors.ink, textAlign: 'center' },
  metricLabel: { marginTop: 2, fontSize: typography.caption, fontWeight: '800', color: colors.inkSecondary, letterSpacing: 0.5, textAlign: 'center' },
});

export default TodayPressureCard;
